fn main() {
  println!("cargo:rerun-if-env-changed=TAURI_CONFIG");
  println!("cargo:rerun-if-changed=tauri.conf.json");

  let res = tauri_build::try_build(tauri_build::Attributes::default());
  if let Err(e) = res {
    println!("cargo:warning=tauri-build failed: {}", e);
  }
}
