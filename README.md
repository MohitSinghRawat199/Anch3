# Slidecraft

A React and Express presentation generator. It includes a local outline generator so you can try the complete flow without an API key. To generate AI-written slides, optionally connect a Gemini API key.

## Run locally

1. Install Node.js 18 or newer.
2. In this folder, run `npm install`.
3. Run `npm run dev`.
4. Open [http://localhost:5173](http://localhost:5173).

The Vite development server serves the React app and proxies `/api` requests to the Express server on port 5000.

## Optional free-tier AI

You can create a Gemini API key in [Google AI Studio](https://aistudio.google.com/app/apikey). Free-tier availability, quotas, and eligibility depend on Google's current terms and region.

1. Copy `.env.example` to `.env`.
2. Add your key as `GEMINI_API_KEY=your_key`.
3. Restart `npm run dev`.

Keep `.env` private; it is excluded from Git. Without a key, the app uses its built-in local outline generator.

## Email/password accounts

Opening the app requires a valid sign-in. New users must register; existing users sign in. Successful authentication opens the slide workspace, and sign-out clears the session cookie and shows a dedicated signed-out page. The client gate is backed by authentication middleware on the slide-generation endpoint.

1. Create a free MongoDB Atlas cluster and a database user, and allow your IP in Network Access.
2. Copy `.env.example` to `.env` and replace `MONGODB_URI` with the Atlas connection string.
3. Set `JWT_SECRET` to a random value at least 32 characters long (for example, generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`).
4. Restart `npm run dev`.

Registration validates names and email addresses, requires passwords of at least 12 characters (maximum 72 UTF-8 bytes for bcrypt), hashes passwords with bcrypt, and limits registration/sign-in attempts. The server also sets security headers, restricts JSON request size, and uses signed, HTTP-only, SameSite cookies.

The server reports a clear setup error for account actions until MongoDB is configured. Do not share the Atlas connection string or JWT secret in chat or commit `.env`.

## PDF export plans and Razorpay payments

Each account gets one free PDF export. After that, export requires paid access: ₹300/month (recurring subscription) or a ₹500 one-time pass valid for 90 days. The server enforces this on `POST /api/billing/consume-export`.

1. Create a Razorpay account and use **Test Mode** keys first. Put `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `.env`.
2. In Razorpay Dashboard, create a monthly plan of ₹300 and set its ID as `RAZORPAY_MONTHLY_PLAN_ID`.
3. Add a webhook to `https://<your-domain>/api/billing/webhook` for the `subscription.charged`, `subscription.cancelled`, `subscription.halted` and `subscription.activated` events, and set its secret as `RAZORPAY_WEBHOOK_SECRET`. Local testing needs a public tunnel.
4. Restart the server. Payments are verified by HMAC signature on the server; secrets never reach the browser.

## Included features

- Topic, audience, presentation style, slide count, and talk duration options.
- Generated slide preview with animated transitions, previous/next navigation, and speaker notes.
- Downloadable 16:9 PDF export with one themed slide per page.
- Email/password registration, sign-in, and sign-out with MongoDB Atlas.
- Responsive React UI and Express generation API.

## Project documentation

The complete setup, architecture, API, security, and troubleshooting guide is available in [`docs/PROJECT-DOCUMENTATION.md`](./docs/PROJECT-DOCUMENTATION.md). Generate the PDF version with:

```powershell
npm run docs:pdf
```
