fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Vendored protoc so the build needs nothing installed on the host.
    std::env::set_var("PROTOC", protoc_bin_vendored::protoc_bin_path()?);
    tonic_build::configure()
        .build_server(false)
        .compile_protos(&["proto/service.proto"], &["proto"])?;
    Ok(())
}
