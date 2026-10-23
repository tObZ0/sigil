// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SigilToken} from "./SigilToken.sol";

/// @title Sigil: sealed launches.
/// @notice Every launch opens with a sealed window. Buyers lock ETH against a
/// hash of their real bid, so nobody (snipers, bots, the creator) can read bid
/// sizes; a deposit can carry extra "cover" to hide even its own size. Then
/// bids are revealed, cover is refunded, and everyone fills pro rata at one
/// price: raised ETH / sale supply. The raise (less fees) seeds a pool that is
/// locked forever and opens at that same price. Unsold-side tokens are burned.
///
/// Lifecycle, per launch: Sealing -> Revealing -> (settle) -> Live | Failed.
contract SigilLaunchpad is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 public constant SALE_SUPPLY = 500_000_000 ether;
    uint256 public constant BPS = 10_000;
    /// Taken from the raise at settlement.
    uint256 public constant PLATFORM_RAISE_BPS = 100; // 1%
    uint256 public constant CREATOR_RAISE_BPS = 50; // 0.5%
    /// Taken from the ETH side of every pool swap, split platform/creator.
    uint256 public constant SWAP_FEE_BPS = 100; // 1%
    /// Kept from a sealed deposit that is never revealed, if the launch goes live.
    uint256 public constant NO_REVEAL_PENALTY_BPS = 1_000; // 10%
    uint256 public constant MIN_SEAL = 10 minutes;
    uint256 public constant MAX_SEAL = 7 days;
    uint256 public constant MIN_REVEAL = 10 minutes;
    uint256 public constant MAX_REVEAL = 2 days;
    uint256 public constant MIN_RAISE_FLOOR = 0.01 ether;
    uint256 public constant MAX_META_BYTES = 24_000;
    uint256 public constant MAX_LAUNCH_FEE = 0.01 ether;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    enum Phase {
        Sealing,
        Revealing,
        Settling,
        Live,
        Failed
    }

    struct Launch {
        address token;
        address creator;
        uint64 sealEnd;
        uint64 revealEnd;
        uint256 minRaise;
        uint256 deposits; // all ETH ever sealed
        uint256 revealedDeposits; // deposits of bidders who revealed
        uint256 raised; // sum of revealed bids
        uint32 bidders;
        uint32 reveals;
        bool settled;
        bool failed;
        uint256 ethReserve;
        uint256 tokenReserve;
    }

    struct Bid {
        bytes32 commitment;
        uint256 deposit;
        uint256 amount; // set on reveal
        bool revealed;
        bool claimed;
    }

    uint256 public launchFee;
    address public feeRecipient;
    Launch[] private _launches;
    mapping(uint256 => mapping(address => Bid)) private _bids;
    /// ETH owed to creators and the platform, withdrawn with withdraw().
    mapping(address => uint256) public owed;

    event LaunchCreated(
        uint256 indexed id,
        address indexed token,
        address indexed creator,
        string name,
        string symbol,
        string meta,
        uint64 sealEnd,
        uint64 revealEnd,
        uint256 minRaise
    );
    event Sealed(uint256 indexed id, address indexed bidder, uint256 deposit);
    event Revealed(uint256 indexed id, address indexed bidder, uint256 amount, uint256 cover);
    event Settled(uint256 indexed id, bool failed, uint256 raised, uint256 poolEth, uint256 poolTokens, uint256 burned);
    event Claimed(uint256 indexed id, address indexed bidder, uint256 tokens, uint256 eth);
    event Swap(uint256 indexed id, address indexed trader, bool buy, uint256 ethAmount, uint256 tokenAmount, uint256 ethReserve, uint256 tokenReserve);
    event Withdrawn(address indexed to, uint256 amount);
    event LaunchFeeSet(uint256 fee);
    event FeeRecipientSet(address recipient);

    error BadParams();
    error WrongPhase(Phase phase);
    error AlreadySealed();
    error NothingSealed();
    error BadReveal();
    error AlreadyDone();
    error Slippage();
    error TransferFailed();

    constructor(address feeRecipient_, uint256 launchFee_) Ownable(msg.sender) {
        if (feeRecipient_ == address(0) || launchFee_ > MAX_LAUNCH_FEE) revert BadParams();
        feeRecipient = feeRecipient_;
        launchFee = launchFee_;
    }

    // ---------------------------------------------------------------- launch

    /// @param meta JSON: description, links and a small data-URI image. Lives
    /// only in the LaunchCreated event, so it costs calldata, not storage.
    function createLaunch(
        string calldata name,
        string calldata symbol,
        string calldata meta,
        uint256 sealDuration,
        uint256 revealDuration,
        uint256 minRaise
    ) external payable nonReentrant returns (uint256 id, address token) {
        uint256 nl = bytes(name).length;
        uint256 sl = bytes(symbol).length;
        if (
            nl == 0 || nl > 32 || sl == 0 || sl > 10 || bytes(meta).length > MAX_META_BYTES || sealDuration < MIN_SEAL
                || sealDuration > MAX_SEAL || revealDuration < MIN_REVEAL || revealDuration > MAX_REVEAL
                || minRaise < MIN_RAISE_FLOOR || msg.value != launchFee
        ) revert BadParams();

        id = _launches.length;
        token = address(new SigilToken(name, symbol, TOTAL_SUPPLY, address(this)));
        uint64 sealEnd = uint64(block.timestamp + sealDuration);
        uint64 revealEnd = uint64(sealEnd + revealDuration);
        Launch storage l = _launches.push();
        l.token = token;
        l.creator = msg.sender;
        l.sealEnd = sealEnd;
        l.revealEnd = revealEnd;
        l.minRaise = minRaise;
        if (msg.value > 0) owed[feeRecipient] += msg.value;
        emit LaunchCreated(id, token, msg.sender, name, symbol, meta, sealEnd, revealEnd, minRaise);
    }

    // ---------------------------------------------------------------- sealed sale

    /// @notice The commitment a bidder seals. Binding the launch and the bidder
    /// stops anyone copying someone else's sealed bid.
    function commitmentOf(uint256 id, address bidder, uint256 amount, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(id, bidder, amount, salt));
    }

    /// @notice Seal a bid. msg.value must cover the real bid; anything above it
    /// is cover, refunded at reveal.
    function seal(uint256 id, bytes32 commitment) external payable nonReentrant {
        Launch storage l = _launch(id);
        Phase p = _phase(l);
        if (p != Phase.Sealing) revert WrongPhase(p);
        if (msg.value == 0 || commitment == bytes32(0)) revert BadParams();
        Bid storage b = _bids[id][msg.sender];
        if (b.commitment != bytes32(0)) revert AlreadySealed();
        b.commitment = commitment;
        b.deposit = msg.value;
        l.deposits += msg.value;
        l.bidders += 1;
        emit Sealed(id, msg.sender, msg.value);
    }

    /// @notice Open your sealed bid. The cover comes straight back.
    function reveal(uint256 id, uint256 amount, bytes32 salt) external nonReentrant {
        Launch storage l = _launch(id);
        Phase p = _phase(l);
        if (p != Phase.Revealing) revert WrongPhase(p);
        Bid storage b = _bids[id][msg.sender];
        if (b.commitment == bytes32(0)) revert NothingSealed();
        if (b.revealed) revert AlreadyDone();
        if (amount == 0 || amount > b.deposit || commitmentOf(id, msg.sender, amount, salt) != b.commitment) {
            revert BadReveal();
        }
        b.revealed = true;
        b.amount = amount;
        l.raised += amount;
        l.revealedDeposits += b.deposit;
        l.reveals += 1;
        uint256 cover = b.deposit - amount;
        emit Revealed(id, msg.sender, amount, cover);
        if (cover > 0) _send(msg.sender, cover);
    }

    /// @notice Anyone can settle once the reveal window closes.
    function settle(uint256 id) external nonReentrant {
        Launch storage l = _launch(id);
        Phase p = _phase(l);
        if (p != Phase.Settling) revert WrongPhase(p);
        l.settled = true;

        if (l.raised < l.minRaise) {
            l.failed = true;
            emit Settled(id, true, l.raised, 0, 0, 0);
            return;
        }

        uint256 platformCut = (l.raised * PLATFORM_RAISE_BPS) / BPS;
        uint256 creatorCut = (l.raised * CREATOR_RAISE_BPS) / BPS;
        // The pool gets what's left of unrevealed deposits after their refunds.
        // Refunds round down per bid in claim(), so their sum never exceeds
        // this aggregate and the contract can always pay everyone.
        uint256 unrevealed = l.deposits - l.revealedDeposits;
        uint256 penalties = unrevealed - (unrevealed * (BPS - NO_REVEAL_PENALTY_BPS)) / BPS;
        uint256 poolEth = l.raised - platformCut - creatorCut + penalties;
        // Open the pool at the sale price: poolEth / poolTokens == raised / SALE_SUPPLY.
        uint256 poolTokens = (poolEth * SALE_SUPPLY) / l.raised;
        uint256 maxPool = TOTAL_SUPPLY - SALE_SUPPLY;
        if (poolTokens > maxPool) poolTokens = maxPool;
        uint256 burned = maxPool - poolTokens;

        l.ethReserve = poolEth;
        l.tokenReserve = poolTokens;
        owed[feeRecipient] += platformCut;
        owed[l.creator] += creatorCut;
        if (burned > 0) IERC20(l.token).safeTransfer(DEAD, burned);
        emit Settled(id, false, l.raised, poolEth, poolTokens, burned);
    }

    /// @notice Collect tokens (live launch) or ETH (failed launch, or a bid
    /// never revealed).
    function claim(uint256 id) external nonReentrant {
        Launch storage l = _launch(id);
        Phase p = _phase(l);
        if (p != Phase.Live && p != Phase.Failed) revert WrongPhase(p);
        Bid storage b = _bids[id][msg.sender];
        if (b.commitment == bytes32(0)) revert NothingSealed();
        if (b.claimed) revert AlreadyDone();
        b.claimed = true;

        uint256 tokens;
        uint256 eth;
        if (l.failed) {
            eth = b.revealed ? b.amount : b.deposit;
        } else if (b.revealed) {
            tokens = (b.amount * SALE_SUPPLY) / l.raised;
        } else {
            eth = (b.deposit * (BPS - NO_REVEAL_PENALTY_BPS)) / BPS;
        }
        emit Claimed(id, msg.sender, tokens, eth);
        if (tokens > 0) IERC20(l.token).safeTransfer(msg.sender, tokens);
        if (eth > 0) _send(msg.sender, eth);
    }

    // ---------------------------------------------------------------- locked pool

    function quoteBuy(uint256 id, uint256 ethIn) public view returns (uint256 tokensOut, uint256 fee) {
        Launch storage l = _launch(id);
        fee = (ethIn * SWAP_FEE_BPS) / BPS;
        uint256 net = ethIn - fee;
        tokensOut = (net * l.tokenReserve) / (l.ethReserve + net);
    }

    function quoteSell(uint256 id, uint256 tokensIn) public view returns (uint256 ethOut, uint256 fee) {
        Launch storage l = _launch(id);
        uint256 gross = (tokensIn * l.ethReserve) / (l.tokenReserve + tokensIn);
        fee = (gross * SWAP_FEE_BPS) / BPS;
        ethOut = gross - fee;
    }

    function buy(uint256 id, uint256 minTokensOut) external payable nonReentrant returns (uint256 tokensOut) {
        Launch storage l = _launch(id);
        Phase p = _phase(l);
        if (p != Phase.Live) revert WrongPhase(p);
        if (msg.value == 0) revert BadParams();
        uint256 fee;
        (tokensOut, fee) = quoteBuy(id, msg.value);
        if (tokensOut == 0 || tokensOut < minTokensOut) revert Slippage();
        l.ethReserve += msg.value - fee;
        l.tokenReserve -= tokensOut;
        _splitFee(l, fee);
        emit Swap(id, msg.sender, true, msg.value, tokensOut, l.ethReserve, l.tokenReserve);
        IERC20(l.token).safeTransfer(msg.sender, tokensOut);
    }

    function sell(uint256 id, uint256 tokensIn, uint256 minEthOut) external nonReentrant returns (uint256 ethOut) {
        Launch storage l = _launch(id);
        Phase p = _phase(l);
        if (p != Phase.Live) revert WrongPhase(p);
        if (tokensIn == 0) revert BadParams();
        uint256 fee;
        (ethOut, fee) = quoteSell(id, tokensIn);
        if (ethOut == 0 || ethOut < minEthOut) revert Slippage();
        IERC20(l.token).safeTransferFrom(msg.sender, address(this), tokensIn);
        l.tokenReserve += tokensIn;
        l.ethReserve -= ethOut + fee;
        _splitFee(l, fee);
        emit Swap(id, msg.sender, false, ethOut, tokensIn, l.ethReserve, l.tokenReserve);
        _send(msg.sender, ethOut);
    }

    // ---------------------------------------------------------------- fees & admin

    function withdraw() external nonReentrant {
        uint256 amount = owed[msg.sender];
        if (amount == 0) revert BadParams();
        owed[msg.sender] = 0;
        emit Withdrawn(msg.sender, amount);
        _send(msg.sender, amount);
    }

    function setLaunchFee(uint256 fee) external onlyOwner {
        if (fee > MAX_LAUNCH_FEE) revert BadParams();
        launchFee = fee;
        emit LaunchFeeSet(fee);
    }

    /// Fees already owed to the old recipient stay withdrawable by it.
    function setFeeRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert BadParams();
        feeRecipient = recipient;
        emit FeeRecipientSet(recipient);
    }

    // ---------------------------------------------------------------- views

    function launchCount() external view returns (uint256) {
        return _launches.length;
    }

    function getLaunch(uint256 id) external view returns (Launch memory launch, Phase phase) {
        Launch storage l = _launch(id);
        return (l, _phase(l));
    }

    function bidOf(uint256 id, address bidder) external view returns (Bid memory) {
        _launch(id);
        return _bids[id][bidder];
    }

    function phaseOf(uint256 id) external view returns (Phase) {
        return _phase(_launch(id));
    }

    // ---------------------------------------------------------------- internals

    function _launch(uint256 id) private view returns (Launch storage) {
        if (id >= _launches.length) revert BadParams();
        return _launches[id];
    }

    function _phase(Launch storage l) private view returns (Phase) {
        if (l.settled) return l.failed ? Phase.Failed : Phase.Live;
        if (block.timestamp < l.sealEnd) return Phase.Sealing;
        if (block.timestamp < l.revealEnd) return Phase.Revealing;
        return Phase.Settling;
    }

    function _splitFee(Launch storage l, uint256 fee) private {
        uint256 half = fee / 2;
        owed[l.creator] += half;
        owed[feeRecipient] += fee - half;
    }

    function _send(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
