use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::Path};
use tauri::Url;

const DEVICE_TOKEN_FILE: &str = "device-token.json";

/// A paired computer's token for one server. Kept apart from the workspace choice, readable
/// only by this user, and never handed to the app's own windows.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct DeviceToken {
    pub origin: String,
    pub token: String,
}

pub fn origin_of(address: &str) -> Option<String> {
    Url::parse(address)
        .ok()
        .map(|url| url.origin().ascii_serialization())
}

/// The saved token, only when it belongs to `origin`.
pub fn read_device_token(data: &Path, origin: &str) -> Option<String> {
    let contents = fs::read_to_string(data.join(DEVICE_TOKEN_FILE)).ok()?;
    let saved: DeviceToken = serde_json::from_str(&contents).ok()?;
    (saved.origin == origin && saved.token.starts_with("c2t_")).then_some(saved.token)
}

pub fn save_device_token(data: &Path, device: &DeviceToken) -> Result<(), String> {
    let error = || "Could not save this computer's pairing.".to_string();
    if origin_of(&device.origin).as_deref() != Some(device.origin.as_str())
        || !device.token.starts_with("c2t_")
    {
        return Err(error());
    }
    fs::create_dir_all(data).map_err(|_| error())?;
    let temporary = data.join(format!("{DEVICE_TOKEN_FILE}.tmp"));
    let _ = fs::remove_file(&temporary);
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary).map_err(|_| error())?;
    let bytes = serde_json::to_vec(device).map_err(|_| error())?;
    file.write_all(&bytes).map_err(|_| error())?;
    file.sync_all().map_err(|_| error())?;
    fs::rename(&temporary, data.join(DEVICE_TOKEN_FILE)).map_err(|_| error())
}

pub fn clear_device_token(data: &Path) {
    let _ = fs::remove_file(data.join(DEVICE_TOKEN_FILE));
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum WorkspaceTarget {
    Unconfigured,
    Local,
    Remote { url: String },
}

impl WorkspaceTarget {
    pub fn validate(self) -> Result<Self, String> {
        let Self::Remote { url } = self else {
            return Ok(self);
        };
        let parsed = Url::parse(url.trim()).map_err(|_| "Enter a valid server address.")?;
        let loopback = matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
        if !(parsed.scheme() == "https" || parsed.scheme() == "http" && loopback)
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.query().is_some()
            || parsed.fragment().is_some()
            || parsed.path() != "/"
        {
            return Err("Use an HTTPS server address without a path, login, or query. HTTP is only available for this computer.".into());
        }
        Ok(Self::Remote {
            url: parsed.to_string(),
        })
    }
}

pub fn read(data: &Path) -> Result<WorkspaceTarget, String> {
    let path = data.join("workspace-target.json");
    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(if data.join("workspace").join("tasks.sqlite").is_file() {
                WorkspaceTarget::Local
            } else {
                WorkspaceTarget::Unconfigured
            })
        }
        Err(_) => return Err("Could not read the selected workspace.".into()),
    };
    serde_json::from_str::<WorkspaceTarget>(&contents)
        .map_err(|_| "Could not read the selected workspace.".to_string())?
        .validate()
}

pub fn save(data: &Path, target: WorkspaceTarget) -> Result<(), String> {
    let target = target.validate()?;
    if target == WorkspaceTarget::Unconfigured {
        return Err("Choose where your workspace will run.".into());
    }
    fs::create_dir_all(data).map_err(|_| "Could not save the workspace choice.")?;
    let bytes = serde_json::to_vec(&target).map_err(|_| "Could not save the workspace choice.")?;
    fs::write(data.join("workspace-target.json"), bytes)
        .map_err(|_| "Could not save the workspace choice.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn remote_workspace_requires_a_safe_address() {
        assert!(WorkspaceTarget::Remote {
            url: "https://server.tailnet.ts.net".into()
        }
        .validate()
        .is_ok());
        assert!(WorkspaceTarget::Remote {
            url: "http://127.0.0.1:1234".into()
        }
        .validate()
        .is_ok());
        for address in [
            "http://server.tailnet.ts.net",
            "https://user:secret@example.com",
            "https://example.com/?key=secret",
            "https://example.com/workspace",
        ] {
            assert!(WorkspaceTarget::Remote {
                url: address.into()
            }
            .validate()
            .is_err());
        }
    }

    #[test]
    fn workspace_choice_survives_restart_without_changing_the_local_workspace() {
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let data = std::env::temp_dir().join(format!(
            "chat2tasks-workspace-choice-{}-{id}",
            std::process::id()
        ));
        let workspace = data.join("workspace");
        fs::create_dir_all(&workspace).unwrap();
        fs::write(workspace.join("tasks.sqlite"), "existing workspace").unwrap();
        fs::write(workspace.join("marker"), "local workspace").unwrap();
        assert_eq!(read(&data).unwrap(), WorkspaceTarget::Local);
        save(
            &data,
            WorkspaceTarget::Remote {
                url: "https://server.tailnet.ts.net".into(),
            },
        )
        .unwrap();
        assert_eq!(
            read(&data).unwrap(),
            WorkspaceTarget::Remote {
                url: "https://server.tailnet.ts.net/".into()
            }
        );
        assert_eq!(
            fs::read_to_string(workspace.join("marker")).unwrap(),
            "local workspace"
        );
        save(&data, WorkspaceTarget::Local).unwrap();
        assert_eq!(read(&data).unwrap(), WorkspaceTarget::Local);
        assert_eq!(
            fs::read_to_string(workspace.join("marker")).unwrap(),
            "local workspace"
        );
        fs::remove_dir_all(data).unwrap();
    }

    fn scratch(name: &str) -> std::path::PathBuf {
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("chat2tasks-{name}-{}-{id}", std::process::id()))
    }

    #[test]
    fn a_device_token_is_kept_privately_and_only_given_to_its_server() {
        let data = scratch("device-token");
        let origin = origin_of("https://wa-service.tail.ts.net:8443/").unwrap();
        assert_eq!(origin, "https://wa-service.tail.ts.net:8443");
        assert_eq!(read_device_token(&data, &origin), None);
        save_device_token(
            &data,
            &DeviceToken {
                origin: origin.clone(),
                token: "c2t_first".into(),
            },
        )
        .unwrap();
        assert_eq!(
            read_device_token(&data, &origin).as_deref(),
            Some("c2t_first")
        );
        assert_eq!(
            read_device_token(&data, "https://wa-service.tail.ts.net"),
            None
        );
        assert_eq!(read_device_token(&data, "https://evil.example"), None);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(data.join(DEVICE_TOKEN_FILE))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        save_device_token(
            &data,
            &DeviceToken {
                origin: origin.clone(),
                token: "c2t_second".into(),
            },
        )
        .unwrap();
        assert_eq!(
            read_device_token(&data, &origin).as_deref(),
            Some("c2t_second")
        );
        clear_device_token(&data);
        assert_eq!(read_device_token(&data, &origin), None);
        fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn a_malformed_device_token_is_not_saved() {
        let data = scratch("bad-device-token");
        for (origin, token) in [
            ("https://server.example/", "c2t_x"),
            ("https://server.example", "not-a-token"),
            ("server.example", "c2t_x"),
        ] {
            assert!(save_device_token(
                &data,
                &DeviceToken {
                    origin: origin.into(),
                    token: token.into(),
                },
            )
            .is_err());
        }
        assert!(!data.join(DEVICE_TOKEN_FILE).exists());
        let _ = fs::remove_dir_all(data);
    }

    #[test]
    fn a_new_installation_requires_a_workspace_choice() {
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let data = std::env::temp_dir().join(format!(
            "chat2tasks-new-workspace-{}-{id}",
            std::process::id()
        ));
        assert_eq!(read(&data).unwrap(), WorkspaceTarget::Unconfigured);
        save(
            &data,
            WorkspaceTarget::Remote {
                url: "https://server.example".into(),
            },
        )
        .unwrap();
        assert_eq!(
            read(&data).unwrap(),
            WorkspaceTarget::Remote {
                url: "https://server.example/".into()
            }
        );
        fs::remove_dir_all(data).unwrap();
    }
}
