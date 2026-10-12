//! Connects and disconnects every tool against $CLOUDBORNE_HOME with a fake key.
//! Used to check the adapters on copies of real config files.
fn main() {
    cloudborne_desktop_lib::roundtrip_for_dev(std::env::args().nth(1).as_deref() == Some("connect-only"));
}
