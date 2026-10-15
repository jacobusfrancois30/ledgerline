# Ledgerline

> Personal budgeting Progressive Web App with Google Gemini. Private, offline-first, mobile-first, and hosted free on GitHub Pages.

---

## 1. Overview

**Ledgerline** is a personal budgeting and spending tracker that you can install directly on your phone’s home screen. It feels like a native mobile app, runs entirely in the browser with **IndexedDB**, and keeps 100% of your financial data strictly on your device.

Gemini powers smart features via your own free API key:
- **Receipt Scanning**: Take a photo of any receipt; Gemini extracts the merchant, total, date, category, and line items, prefilling your transaction form.
- **Bank Alert Parser**: Paste one or many transaction SMS messages or emails from your bank (FNB, Capitec, Nedbank, Standard Bank, Absa, etc.); Gemini extracts clean transactions for preview before import.
- **Smart Categorize**: Analyzes your uncategorized payees without leaking amounts or dates, suggests categories, and creates auto-rules.
- **Ask About My Money**: An AI budgeting companion that uses a privacy-safe summary of your ledger to answer questions in your currency (ZAR by default) and highlight concrete actions.
- **Monthly Review**: High-level review analyzing financial wins, watch areas, and one concrete action for the month.

---

## 2. Privacy & Security

- **Zero Backend**: There are no servers, analytics, trackers, or third-party cookies.
- **On-Device Storage**: All accounts, transactions, budgets, goals, and bills are stored in the browser's IndexedDB.
- **Secrets are Never Committed**: Your Gemini API key is typed into the app by you and saved only in your device's IndexedDB.
- **Passcode Protection**: Optional PIN lock screen hashed with WebCrypto SHA-256 protects your screen on shared devices.
- **Data Minimization**: AI queries only send what is needed (e.g. Smart Categorize only sends unique payee names, never dates or amounts).

---

## 3. How to Install on Your Phone

### iPhone (iOS Safari)
1. Open your hosted Ledgerline URL in **Safari** (e.g., `https://<your-username>.github.io/ledgerline/`).
2. Tap the **Share** button (the square with an arrow pointing upward) at the bottom.
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add** in the top right.
5. Tap the Ledgerline icon on your home screen — it launches in full-screen standalone mode.

### Android (Chrome)
1. Open the URL in **Google Chrome**.
2. Tap the three dots menu (**⋮**) in the top right.
3. Tap **Install app** (or **Add to Home screen**).
4. Tap **Install** to confirm. Ledgerline appears on your home screen and in your app drawer.

### Desktop (Chrome / Edge / Safari)
1. In the address bar, click the **Install Ledgerline** icon (or menu → **Install Ledgerline**).
2. The app opens in its own window with keyboard shortcuts and desktop layout.

---

## 4. Getting a Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Sign in with your Google Account and click **Create API key**.
3. Copy your key from the Google AI Studio dashboard.
4. In Ledgerline, go to **Setup** → **Gemini API Configuration**, paste your key, and tap **Save API Key**.
5. Tap **Test connection** to verify connectivity.

### Recommended Security Restrictions:
In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials):
- **API restriction**: Restrict the key specifically to the **Generative Language API**.
- **Website restriction**: Add an HTTP referrer restriction to `https://<your-username>.github.io/*`.

---

## 5. Hosting on GitHub Pages (Free)

1. Create a new **public** repository named `ledgerline` on your personal GitHub account.
2. Initialize and push your files:
   ```bash
   git remote add origin https://github.com/<your-username>/ledgerline.git
   git push -u origin main
   ```
3. Enable GitHub Pages:
   - On GitHub, navigate to **Settings** → **Pages**.
   - Under **Build and deployment** → **Source**, select **Deploy from a branch**.
   - Choose branch **`main`** and folder **`/ (root)`**, then click **Save**.
4. Your PWA is live in 1-2 minutes at:
   ```
   https://<your-username>.github.io/ledgerline/
   ```

---

## 6. Features & Architecture

```
ledgerline/
  index.html                # PWA entry point & responsive app shell
  manifest.webmanifest     # Web App Manifest (standalone, theme colors, icons)
  sw.js                     # Service Worker (offline cache, bypasses Gemini)
  styles.css                # CSS design system (tokens, light/dark, responsive rail)
  icons/                    # 192, 512, maskable 512, apple-touch 180, SVG icons
  src/
    main.js                 # App boot, state management, routing, event delegation
    store.js                # IndexedDB persistence, backup export/restore, PIN hash
    model.js                # Financial logic, stats, rollover, auto-categorize, ZAR defaults
    csv.js                  # RFC-4180 CSV parser, column matcher, CSV export
    gemini.js               # Gemini REST API (receipts, alerts, categorization, chat)
    ui/
      sheet.js              # Modal sheets, confirmation dialogues, form helpers
      toast.js              # Accessible toast notifications
      charts.js             # Inline SVG charts: cash flow bar chart, sparkline, progress ring
    views/
      overview.js           # Safe-to-spend, cash flow, budget pulse, insights, AI chat
      transactions.js       # Day-grouped list, filters, add/edit, receipts, bank SMS
      budgets.js            # Monthly budgets, rollovers, 3-month suggestions
      bills.js              # Recurring bills, auto-paid detector, subscription finder
      goals.js              # Savings milestones, monthly needed calculation, rings
      setup.js              # Accounts, categories, rules, Gemini settings, backups
  README.md
  LICENSE (MIT)
  .gitignore
```

---

## 7. License

MIT License. Free to use, adapt, and self-host.
