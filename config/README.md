# config

App configuration templates.

| File | Tracked? | What |
|------|----------|------|
| `accounts.example.yaml` | ✅ committed | Template with placeholder/zero balances — the shape the app expects. |
| `accounts.yaml` | 🚫 gitignored | Your **real** seeded account balances / loan figures. Never commit it. |

Copy the example to `accounts.yaml` and fill in real values locally. See `.claude/rules/data-privacy.md`.
