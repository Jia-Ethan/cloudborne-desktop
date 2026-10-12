mod api;
mod commands;
mod error;
mod fsx;
mod install;
mod session;
mod state;
mod tools;

pub fn run() {
    let session = session::Session::new().expect("failed to start session");
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(session)
        .invoke_handler(tauri::generate_handler![
            commands::login,
            commands::login_2fa,
            commands::logout,
            commands::me,
            commands::tools_status,
            commands::groups_for,
            commands::connect_tool,
            commands::disconnect_tool,
            commands::install_tool,
            commands::relay_origin,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[doc(hidden)]
pub fn roundtrip_for_dev(connect_only: bool) {
    let home = tools::home_dir();
    let conn = tools::Connection {
        origin: "https://relay.example".into(),
        api_key: "sk-sandbox".into(),
        models: vec!["glm-5.3".into(), "grok-4.7".into()],
    };
    for t in tools::ToolId::ALL {
        let r = tools::connect(t, &home, &conn).map(|_| ());
        println!("{:?} connect: {:?} connected={:?}", t, r, tools::is_connected(t, &home));
        if !connect_only {
            let r = tools::disconnect(t, &home).map(|_| ());
            println!("{:?} disconnect: {:?} connected={:?}", t, r, tools::is_connected(t, &home));
        }
    }
}
