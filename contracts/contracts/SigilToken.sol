// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice A plain fixed-supply ERC-20. The whole supply is minted to the
/// launchpad at creation; there is no owner, no mint, no tax, no blacklist.
contract SigilToken is ERC20 {
    constructor(string memory name_, string memory symbol_, uint256 supply, address holder) ERC20(name_, symbol_) {
        _mint(holder, supply);
    }
}
