# Bundled Binaries (`dependencies/`)

Prebuilt executables shipped verbatim onto the modem by `build.sh` →
`install.sh` (installed to `/usr/bin/`, mode 755). They are cross-compiled
out-of-band, not by this repo's build. This file records how to reproduce them.

> The binaries here are committed directly to git (not gitignored, no LFS).
> Commit a rebuilt binary together with its source change and this README.

Target device: **Quectel RM551E-GL** — OpenWRT 23.05, **aarch64** musl userspace
(`/lib/ld-musl-aarch64.so.1`), AT pipe on the glink char device **`/dev/smd11`**
(not a UART/TTY). Binaries target `aarch64-unknown-linux-musl` natively.

| Binary | Source | Notes |
|--------|--------|-------|
| `qmanager_atd` | [`native/qmanager_atd/`](../native/qmanager_atd) (in this repo) | Rust AT broker + `qcmd` client — see below and `docs/features/at-broker.md` |

---

## `qmanager_atd`

The Rust AT broker and the `qcmd` client in one static binary. Source lives in
this repo at `native/qmanager_atd/` (std + `libc` only). `/usr/bin/qcmd` is a
symlink to it, and it is QManager's only AT path; see
`docs/features/at-broker.md`.

### Rebuild (static aarch64 musl)

Built in WSL Ubuntu (or any Linux) with rustup. musl targets ship self-contained
CRT objects and `rust-lld`, so no cross gcc is needed; the crate's
`.cargo/config.toml` sets `linker = "rust-lld"` and `+crt-static`.

```sh
rustup target add aarch64-unknown-linux-musl     # once
cd native/qmanager_atd
cargo test --release                             # host unit tests (267 at 0.6.0)
cargo build --release --target aarch64-unknown-linux-musl
cp target/aarch64-unknown-linux-musl/release/qmanager_atd ../../dependencies/qmanager_atd

# MUST be static — verify (no INTERP segment):
readelf -l ../../dependencies/qmanager_atd | grep -i INTERP   # -> (nothing)
file ../../dependencies/qmanager_atd   # ELF 64-bit LSB executable, ARM aarch64, statically linked
```

Shipped build: **0.6.1** (WDS packet counter for Data Used, with IPv6-only call support), 668064 bytes, md5 `de71a292e8160465b4895988fe32d995` (rebuilt from `native/qmanager_atd/` in WSL on a Linux filesystem, 278 host tests green on the merged tree, verified static as above). The previous shipped build was 0.5.0 (NAS Config Signal Info v2 held by the broker, so the live file carries SINR and NR), 650560 bytes, md5 `1552dcf62e2aa318ac4819fc03f382c6`. Before that 0.4.1 (live signal at 1 Hz in both tiers, 5 Hz `aim` parked), 647904 bytes, md5 `14112f99eb2a68dce66db6f3aa5ce90b`. Before that, 0.4.0 (5 Hz `aim`) was 647984 bytes, md5 `96cb55dbc2d942e7c779e3376f394656`.

Build on a Linux filesystem (e.g. copy the crate into `~/`), not across
`/mnt/<drive>`, and commit the binary together with any source change.
`.gitattributes` marks it `binary`; never let CRLF conversion touch it.

### On-device smoke test

```sh
qcmd 'AT'                      # -> AT / OK, via the broker (or its in-process fallback)
qcmd -j 'ATI'                  # -> {"success": true, "response": ..., "command": "ATI"}
ls -la /usr/bin/qcmd           # -> qcmd -> qmanager_atd
ls -la /var/run/qmanager_atd.sock   # -> srw------- root
```

---

## Retired: `sms_tool`

Until SMS phase 4 (2026-10-18) this directory also shipped a patched static
armhf build of [`obsy/sms_tool`](https://github.com/obsy/sms_tool) (commit
94b66b9 plus `sms_tool.patch`). Every caller now uses the broker's `qsms`, so the
binary and patch were removed; both, with the rebuild recipe, are in git history
before that commit, and its behaviour is documented in
`docs/reference/sms-tool/`. `install.sh` deletes an existing
`/usr/bin/sms_tool`, as it does `atcli_smd11`.
