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
