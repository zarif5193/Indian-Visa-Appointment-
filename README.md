# Indian Visa Appointment Booking System

Customer-এ একবার তথ্য+ডকুমেন্ট+পেমেন্ট দিলে, বাকি workflow (payment verification → accept → booking → receipt) সম্পূর্ণ Admin Panel-এর মধ্য দিয়ে চলে।

## Features

- **Customer Portal** — ৬ ধাপের application form (personal, passport, visa details, center preference, documents/photo, bKash payment), Application ID, status check, correction form
- **Payment** — আপনার bKash নম্বর customer-কে দেখায়; customer Send Money করে TrxID submit করে; আপনি Admin Panel-এ verify করুন (✓/✗)
- **Admin Panel** — dashboard (status pipeline), application/document/payment review, accept/reject/correction request, booking workflow, OTP log, CSV export
- **Booking Assistant Sheet** — প্রতিটি accepted application-এর সব data copy-ready printable sheet + checklist + official site link
- **Automatic Receipt PDF** — "Mark Booked" করার সাথে সাথে receipt PDF automatic তৈরি → Admin Panel + customer-এর status page দুই জায়গা থেকে download
- **Status Pipeline** — `pending → payment verified → accepted → booking in progress → slot found → booked` (failed/rejected/correction-ও track হয়)

## Run

Database: **PostgreSQL (Neon)** — connection string `.env` file-এ `DATABASE_URL` হিসেবে থাকবে:

```bash
cp .env.example .env    # তারপর .env-এ আপনার Neon connection string দিন
```

> ⚠️ `.env` file-এ database password থাকে — এটা git-ignored, কখনো GitHub-এ push করবেন না।

**সব table (settings, sessions, applications, application_files, status_log, otp_logs) server start-এ automatic create হয় — কিছু করতে হবে না।**

```bash
cd visa-booking
npm install
npm start          # http://localhost:3000
```

- Customer site: `http://localhost:3000`
- Status check: `http://localhost:3000/status`
- Admin panel: `http://localhost:3000/admin`

**First run:** terminal-এ initial admin password print হয় (সাথে `data/.admin_password.txt`-এ save হয়)। প্রথম login-এর পর Settings থেকে নতুন password করে নিন।

## Workflow (Admin)

1. Customer application দিলে Dashboard-এ "Needs Action"-এ আসবে → **payment verify** (bKash app-এ TrxID চেক করে)
2. সব ঠিক থাকলে **Accept Application** → Booking Queue
3. তথ্য/ডকুমেন্ট ভুল হলে **Request Correction** → customer Status page-এ correction দিলে আবার pending-এ ফিরে আসবে
4. Booking Queue-এ থেকে **Open Booking Sheet** → official website-এ data copy-paste করে booking করুন (OTP customer মোবাইলে পাবে, প্রয়োজনে OTP Log-এ record করুন)
5. Booking শেষে **Mark Booked** (Booking ID + date/time দিন) → receipt PDF **নিজে থেকেই** তৈরি হয়ে Receipts section-এ চলে আসবে
6. Receipt customer-কে দিন (তিনি Status page থেকেও নিতে পারবেন)

## bKash Merchant API — পরবর্তী upgrade (100% automatic payment confirm)

এখন payment verify manual (TrxID চেক)। bKash-এ **merchant/corporate account** নিলে [bKash Checkout API](https://developer.bka.sh/docs/product-overview) integrate করে customer payment **automatic** confirm করা যাবে — TrxID-র ঝামেলাই থাকবে না। এটিই bKash-এর official/legal integration path (App Key/Secret, tokenized checkout, auto status callback)।

> ⚠️ **একটা গুরুত্বপূর্ণ সীমা:** bKash-এর personal account-এ "send money" automation-এর কোনো official API নেই। তাই official site-এর appointment fee payment সবসময় manual (স্বাভাবিক bKash flow) দিয়ে করতে হবে — stored PIN/OTP দিয়ে automation করা ToS violation এবং account freeze-এর গুরুতর ঝুঁকি।

## Legal / ToS Notes

- এই system **human-assisted booking** service — official Indian visa website-এ (indianvisa-bangladesh.nic.in / IVAC) bot, auto-login বা CAPTCHA bypass ব্যবহার **করা যাবে না**; সেটা official site-এর ToS violation এবং আইনি ঝুঁকি তৈরি করে।
- High Commission of India-এর advisory অনুযায়ী appointment slot-এর জন্য extra payment চাওয়া **fraud** হিসেবে চিহ্নিত। আপনার service charge শুধু আপনার পরিশ্রমের (document management, booking assistance) জন্য নিন — "slot resale" হিসেবে position করবেন না।
- Customer-এর passport data সংবেদনশীল। Bangladesh Digital Security Act 2023-এর আওতায় data-র দায়িত্বশীল হ্যান্ডলিং (access control, HTTPS, প্রয়োজনের বেশি retention না রাখা) করা আবশ্যক।

## Security Checklist (production-এর আগে)

- [ ] HTTPS (Let's Encrypt / nginx reverse proxy)
- [ ] Admin password পরিবর্তন (৮+ character, unique)
- [ ] `data/.admin_password.txt` delete
- [ ] Database backup: Neon-এর built-in branch/PITR backup ব্যবহার করুন; `data/uploads` + `data/receipts` (files) নিয়মিত backup করুন
- [ ] Firewall: শুধু 80/443 open, 3000 internal
- [ ] Neon connection string কখনো public repo-তে commit করবেন না (env variable ব্যবহার করুন)

## Deploy (VPS)

```bash
# node 18+ থাকতে হবে
scp -r visa-booking user@server:~/
ssh user@server
cd ~/visa-booking && npm install --omit=dev
# DATABASE_URL দিয়ে Neon connection দিন (যদি code-এ hardcoded না রাখতে চান):
export DATABASE_URL="postgresql://user:pass@host/neondb?sslmode=require"
# PM2 দিয়ে চালাতে:
npm i -g pm2 && pm2 start server.js --name visa-booking
# এরপর nginx-এ server_name + proxy_pass http://127.0.0.1:3000
```

## File Structure

```
visa-booking/
├── server.js          # Express + PostgreSQL(Neon) + API (public + admin) + PDF receipt
├── public/
│   ├── index.html     # customer landing + application wizard
│   ├── apply.js
│   ├── status.html    # status check + correction form
│   ├── status.js
│   ├── admin.html     # admin panel SPA
│   ├── admin.js
│   └── style.css
├── data/
│   ├── uploads/       # customer files (random names, API-only access)
│   └── receipts/      # generated PDF receipts
└── README.md
```

> Note: application/document/payment data **Neon PostgreSQL**-এ থাকে; uploaded files ও receipt PDF-সমূহ server-এর `data/` folder-এ থাকে (আলোচনা: Neon-এ S3-compatible storage থাকলে files-ও সেখানে রাখা যাবে)।
