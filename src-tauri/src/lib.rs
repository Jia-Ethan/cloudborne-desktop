mod accounts;
mod agent;
mod api;
mod commands;
mod ddz;
mod error;
mod fsx;
mod install;
mod lang;
mod window;
mod session;
mod state;
mod tools;
mod update;

pub fn run() {
    let session = session::Session::new().expect("failed to start session");
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(session)
        .manage(agent::SharedRuns::default())
        .manage(ddz::SharedLine::default())
        .setup(|app| {
            let config = app.config().app.windows.first().cloned().expect("main window config");
            window::style(tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?).build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            update::update_install,
            commands::login,
            commands::login_2fa,
            commands::logout,
            commands::me,
            commands::accounts_list,
            commands::account_switch,
            commands::account_add_begin,
            commands::account_remove,
            commands::tools_status,
            commands::groups_for,
            commands::connect_tool,
            commands::disconnect_tool,
            commands::install_tool,
            commands::rates,
            commands::usage,
            commands::usage_keys,
            commands::keys_list,
            commands::key_groups,
            commands::key_create,
            commands::key_update,
            commands::key_delete,
            commands::key_models,
            commands::open_ccswitch,
            commands::service_status,
            commands::lottery_status,
            commands::lottery_open,
            commands::lottery_buy,
            commands::ddz_status,
            commands::ddz_versus,
            commands::ddz_connect,
            commands::ddz_send,
            commands::ddz_close,
            commands::redeem,
            commands::redeem_history,
            commands::token_packs,
            commands::transfer,
            commands::invites,
            commands::invite_create,
            commands::invite_revoke,
            commands::admin_overview,
            commands::admin_users,
            commands::admin_user,
            commands::admin_usage,
            commands::admin_user_concurrency,
            commands::admin_user_balance,
            commands::admin_user_status,
            commands::admin_user_groups,
            commands::admin_user_inviter,
            commands::admin_user_set_inviter,
            commands::admin_lottery_settings,
            commands::admin_groups,
            commands::admin_lottery_save,
            commands::admin_lottery_defaults,
            commands::admin_lottery_summary,
            commands::admin_lottery_draws,
            commands::admin_ddz_settings,
            commands::admin_ddz_save,
            commands::admin_ddz_summary,
            commands::relay_origin,
            commands::set_language,
            commands::agent_models,
            commands::agent_sessions,
            commands::agent_session,
            commands::agent_search,
            commands::agent_update_session,
            commands::agent_delete_session,
            commands::agent_send,
            commands::agent_stop,
            commands::agent_answer,
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
        platform: "openai".into(),
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
