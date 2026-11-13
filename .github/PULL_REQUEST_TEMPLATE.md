## What changes and why

<!-- Describe the change, the problem it solves and why this approach fits. -->

## Related issue

<!-- Use "Closes #123" if this resolves an issue. -->

## Testing

<!-- List the tests added and the commands run.
Say which devices and browsers you tried by hand, including phone orientation for interface changes.
Separate real-device checks from what was only checked in a test browser, such as Playwright WebKit.
Mention anything not checked. -->

## Checklist

<!-- Mark items that apply. Explain any that do not apply in Testing. -->

- [ ] `mise run check` or the CI equivalent passes.
- [ ] A test of the new behavior fails without this change.
- [ ] `CHANGELOG.md` has a line under `Unreleased` for anything users notice.
- [ ] Docs are updated for changes to setup, configuration or described behavior.
- [ ] For interface changes, I checked at 390 px on a phone in portrait and landscape, and on a desktop.
- [ ] For changes to the game frame, `runtime/` or `server/src/play/`, I followed the [player security checklist](https://docs.renplay.org/developers/architecture/#player-security-checklist).
