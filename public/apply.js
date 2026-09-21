/* Customer application wizard */
const S = { step: 1, total: 6, cfg: null, ref: null };

const VISA_TYPES = ['Tourist', 'Business', 'Medical', 'Student', 'Employment', 'Conference', 'Sport', 'Transit', 'Journalist', 'Other'];
const ENTRY_TYPES = ['Single', 'Double', 'Multiple'];
const PASSPORT_TYPES = ['Ordinary', 'Official', 'Diplomatic', 'Emergency'];
const NATIONALITIES = ['Bangladesh', 'India', 'Other'];
const GENDERS = ['Male', 'Female', 'Other'];

function init() {
  fetch('/api/public/config').then(r => r.json()).then(cfg => {
    S.cfg = cfg;
    document.getElementById('footName').textContent = cfg.business_name;
    document.title = cfg.business_name;
    if (!cfg.accept_new) { document.getElementById('closedCard').hidden = false; return; }
    buildWizard();
  }).catch(() => {});
}

function startApply(e) {
  if (e) e.preventDefault();
  const card = document.getElementById('wizardCard');
  if (!S.cfg) return;
  if (!S.cfg.accept_new) { document.getElementById('closedCard').hidden = false; document.getElementById('closedCard').scrollIntoView({ behavior: 'smooth' }); return; }
  card.hidden = false;
  showStep(1);
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function inp(name, type, ph, extra = '') {
  return `<input name="${name}" type="${type}" placeholder="${ph}" ${extra}>`;
}
function sel(name, opts, ph) {
  return `<select name="${name}"><option value="">${ph || '— Select —'}</option>${opts.map(o => `<option>${o}</option>`).join('')}</select>`;
}
function field(label, bn, inner, req, hint) {
  return `<div class="field"><label>${label} ${bn ? `<small>(${bn})</small>` : ''} ${req ? '<span class="req">*</span>' : ''}</label>${inner}${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
}

function stepHTML(n) {
  if (n === 1) return `
    <div class="step-title">১) Personal Information <small style="font-size:13px;color:var(--muted)">/ ব্যক্তিগত তথ্য</small></div>
    <div class="step-sub">Passport-এর সাথে সব তথ্য মিলিয়ে দিন। ভুল হলে booking-এ সমস্যা হবে।</div>
    <div class="grid2">
      ${field('Full Name', 'পাসপোর্ট অনুযায়ী পুরো নাম', inp('full_name', 'text', 'As written in passport'), 1)}
      ${field('Gender', 'লাইঙ্গিক', sel('gender', GENDERS), 1)}
      ${field('Date of Birth', 'জন্ম তারিখ', inp('dob', 'date'), 1)}
      ${field('Nationality', 'নাগরিকত্ব', sel('nationality', NATIONALITIES), 1)}
      ${field('Mobile Number', 'মোবাইল — OTP এই নম্বরে আসবে', inp('mobile', 'tel', '01XXXXXXXXX'), 1)}
      ${field('Email', 'ইমেইল', inp('email', 'email', 'example@mail.com'), 0)}
      ${field('NID Number', 'এনআইডি নম্বর (optional)', inp('nid_number', 'text', 'Optional'), 0)}
      ${field('Occupation', 'পেশা', inp('occupation', 'text', 'e.g. Business / Student / Employee'), 0)}
      ${field('Employer / Institute', 'কর্মসংস্থা / প্রতিষ্ঠান (optional)', inp('employer', 'text', 'Optional'), 0)}
    </div>
    <div class="grid1" style="margin-top:14px">
      ${field('Current Address', 'বর্তমান ঠিকানা', inp('address', 'text', 'House, road, area, district'), 1)}
    </div>`;
  if (n === 2) return `
    <div class="step-title">২) Passport Information <small style="font-size:13px;color:var(--muted)">/ পাসপোর্ট তথ্য</small></div>
    <div class="step-sub">পাসপোর্ট হাতে নিয়ে তথ্য দিন। পাসপোর্টের validity কমপক্ষে <b>৬ মাস</b> হতে হবে।</div>
    <div class="grid2">
      ${field('Passport Number', 'পাসপোর্ট নম্বর', inp('passport_number', 'text', 'e.g. AB1234567'), 1)}
      ${field('Passport Type', 'পাসপোর্টের ধরন', sel('passport_type', PASSPORT_TYPES), 1)}
      ${field('Issue Date', 'ইস্যু তারিখ', inp('passport_issue_date', 'date'), 1)}
      ${field('Expiry Date', 'মেয়াদুত্তর তারিখ', inp('passport_expiry_date', 'date'), 1)}
      ${field('Place of Issue', 'ইস্যু স্থান', inp('passport_issue_place', 'text', 'Bangladesh'), 1, 'Bangladesh-এর জন্য সাধারণত "Bangladesh"')}
    </div>`;
  if (n === 3) return `
    <div class="step-title">৩) Visa Details <small style="font-size:13px;color:var(--muted)">/ ভিসার তথ্য</small></div>
    <div class="step-sub">যে ভিসা লাগবে ও যখন যাবেন — সঠিকভাবে দিন।</div>
    <div class="grid2">
      ${field('Visa Type', 'ভিসার ধরন', sel('visa_type', VISA_TYPES), 1)}
      ${field('Entry Type', 'Single/Double/Multiple', sel('entry_type', ENTRY_TYPES), 1)}
      ${field('Intended Arrival', 'যাবার তারিখ (approx.)', inp('arrival_date', 'date'), 1)}
      ${field('Intended Departure', 'ফিরে আসার তারিখ', inp('departure_date', 'date'), 1)}
      ${field('Address in India', 'ভারতের ঠিকানা (যদি থাকে)', inp('indian_address', 'text', 'Hotel/relative address in India'), 0)}
      ${field('Sponsor Name', 'Sponsor (optional)', inp('sponsor_name', 'text', 'If sponsored'), 0)}
      ${field('Sponsor Relation', 'Sponsor-এর সম্পর্ক', inp('sponsor_relation', 'text', 'e.g. Business partner / Relative'), 0)}
    </div>
    <div class="grid1" style="margin-top:14px">
      ${field('Purpose of Visit', 'ভিসার উদ্দেশ্য', `<textarea name="purpose_detail" placeholder="e.g. Business meeting with supplier in Delhi, 5 days"></textarea>`, 1)}
    </div>`;
  if (n === 4) return `
    <div class="step-title">৪) Appointment Preference <small style="font-size:13px;color:var(--muted)">/ স্লট প্রিফারেন্স</small></div>
    <div class="step-sub">কোন IVAC center-এ এবং কোন তারিখের মধ্যে appointment চান।</div>
    <div class="grid2">
      ${field('Visa Center (IVAC)', 'কোথায় appointment চান', sel('visa_center', S.cfg.centers), 1)}
      ${field('Preferred Earliest Date', 'সর্বনিম্ন তারিখ', inp('pref_earliest', 'date'), 1)}
      ${field('Preferred Latest Date', 'সর্বোচ্চ তারিখ', inp('pref_latest', 'date'), 1, 'আমরা এই date-এর মধ্যে যেকোনো available slot book করার চেষ্টা করব')}
    </div>`;
  if (n === 5) return `
    <div class="step-title">৫) Documents &amp; Photo <small style="font-size:13px;color:var(--muted)">/ ডকুমেন্ট ও ছবি</small></div>
    <div class="step-sub">স্পষ্ট (clear) স্ক্যান/ছবি দিন। Max 8 MB per file. JPG/PNG/WebP (document-এর জন্য PDF-ও)।</div>
    <div class="upload-grid">
      <div class="upload-box">
        <b>Passport Size Photo <span class="req">*</span></b>
        <div class="hint">White background, recent, face visible. JPG/PNG/WebP, max 3 MB.</div>
        <input type="file" name="photo" accept="image/*">
        <div class="photo-preview" id="photoPrev"></div>
      </div>
      <div class="upload-box">
        <b>Passport Bio-page Scan <span class="req">*</span></b>
        <div class="hint">সম্পূর্ণ bio-page (ফটো ও নাম যে পাতা) clear স্ক্যান। JPG/PNG/PDF, max 8 MB.</div>
        <input type="file" name="passport_bio" accept="image/*,application/pdf">
      </div>
      <div class="upload-box">
        <b>Other Supporting Documents (optional, max 4)</b>
        <div class="hint">Flight ticket, hotel booking, bank statement, invitation letter — যেগুলো relevant।</div>
        <input type="file" name="extra_doc" multiple accept="image/*,application/pdf">
      </div>
    </div>`;
  if (n === 6) {
    const bk = S.cfg.bkash_number
      ? `<div class="bkash-box">
           <div class="lbl">আমাদের bKash নম্বরে (Send Money)</div>
           <div class="copy-row"><span class="num" id="bkNum">${bk2(S.cfg.bkash_number)}</span>
           <button type="button" class="btn btn-sm btn-ghost" onclick="copyBk()">Copy</button></div>
         </div>`
      : `<div class="notice">Payment details এখনো configure করা হয়নি। পরে আবার চেষ্টা করুন।</div>`;
    return `
    <div class="step-title">৬) Payment &amp; Submit <small style="font-size:13px;color:var(--muted)">/ পেমেন্ট ও জমা</small></div>
    <div class="step-sub">নিচের মোট টাকা bKash-এ Send Money করে Transaction ID দিন।</div>
    ${bk}
    <table class="fee-table">
      <tr><td>Service Charge (আমাদের service fee)</td><td style="text-align:right">BDT ${S.cfg.service_fee}</td></tr>
      <tr><td>IVAC Appointment / Processing Fee (official)</td><td style="text-align:right">BDT ${S.cfg.official_fee}</td></tr>
      <tr class="total"><td>Total Payable</td><td style="text-align:right">BDT ${S.cfg.total}</td></tr>
    </table>
    <div class="grid2">
      ${field('Amount Paid (BDT)', 'যে টাকা দিলে', inp('payment_amount', 'number', String(S.cfg.total)), 1)}
      ${field('bKash Transaction ID', 'TrxID (bKash app-এ দেখা যাবে)', inp('payment_trx_id', 'text', 'e.g. 9H4K7L2M3N'), 1)}
      ${field('Payment Date & Time', 'পেমেন্টের সময়', inp('payment_date', 'datetime-local'), 1)}
      ${field('Your bKash Number', 'যে নম্বর থেকে পাঠালেন', inp('payment_from_number', 'tel', '01XXXXXXXXX'), 1)}
    </div>
    <div style="margin-top:16px">
      <label class="check-consent"><input type="checkbox" name="consent1"> <span>আমি ঘোষণা করছি যে উপরে দেওয়া সব তথ্য সঠিক। ভুল তথ্যের জন্য আমি দায়ী থাকব। <small>(I confirm all information is correct.)</small></span></label>
      <label class="check-consent"><input type="checkbox" name="consent2"> <span>আমি সম্মত যে booking process-এর জন্য আমার তথ্য ব্যবহার করা হবে এবং প্রয়োজনে আমি booking team-কে আমার phone-এ আসা OTP share করব। <small>(I consent to OTP sharing during booking.)</small></span></label>
    </div>`;
  }
  return '';
}

function bk2(v) { return String(v); }

function buildWizard() {
  const body = document.getElementById('wizBody');
  let steps = '';
  for (let i = 1; i <= S.total; i++) {
    steps += `<div class="step" data-step="${i}" hidden>${stepHTML(i)}</div>`;
  }
  body.innerHTML = `<form id="wizForm">${steps}<div id="wizErrors"></div>
    <div class="wiz-nav">
      <button type="button" class="btn btn-outline" id="btnPrev" onclick="move(-1)">← আগের ধাপ</button>
      <button type="button" class="btn btn-primary" id="btnNext" onclick="move(1)">পরের ধাপ →</button>
    </div></form>`;
  body.querySelector('input[name=photo]').addEventListener('change', e => {
    const p = document.getElementById('photoPrev');
    p.innerHTML = e.target.files[0] ? `<img src="${URL.createObjectURL(e.target.files[0])}" alt="preview">` : '';
  });
}

function showStep(n) {
  S.step = n;
  document.querySelectorAll('.step').forEach(el => el.hidden = +el.dataset.step !== n);
  const prog = document.getElementById('progress');
  prog.innerHTML = Array.from({ length: S.total }, (_, i) => `<div class="seg ${i < n ? 'on' : ''}"></div>`).join('');
  const prev = document.getElementById('btnPrev');
  const next = document.getElementById('btnNext');
  prev.style.visibility = n === 1 ? 'hidden' : 'visible';
  next.textContent = n === S.total ? '✓ Submit Application' : 'পরের ধাপ →';
  next.className = n === S.total ? 'btn btn-ok' : 'btn btn-primary';
  document.getElementById('wizErrors').innerHTML = '';
}

function val(f) {
  const el = document.querySelector(`[name="${f}"]`);
  return el ? String(el.value || '').trim() : '';
}
function fileOf(name) { const el = document.querySelector(`input[name="${name}"]`); return el && el.files && el.files[0]; }

function validateStep(n) {
  const E = [];
  const mobileRe = /^01[3-9]\d{8}$/;
  if (n === 1) {
    if (val('full_name').length < 5) E.push('Full name দিন (pass port-এর মতোই)।');
    if (!val('gender')) E.push('Gender select করুন।');
    if (!val('dob')) E.push('Date of birth দিন।');
    if (!val('nationality')) E.push('Nationality select করুন।');
    if (!mobileRe.test(val('mobile'))) E.push('Valid Bangladeshi mobile দিন (01XXXXXXXXX)।');
    if (val('email') && !/^\S+@\S+\.\S+$/.test(val('email'))) E.push('Email format সঠিক নয়।');
    if (val('address').length < 8) E.push('Complete address দিন।');
  }
  if (n === 2) {
    if (!/^[A-Z0-9]{6,15}$/i.test(val('passport_number'))) E.push('Passport number সঠিক নয় (6-15 chars)।');
    if (!val('passport_type')) E.push('Passport type select করুন।');
    if (!val('passport_issue_date')) E.push('Passport issue date দিন।');
    if (!val('passport_expiry_date')) E.push('Passport expiry date দিন।');
    else {
      const min = new Date(); min.setDate(min.getDate() + 180);
      if (val('passport_expiry_date') < min.toISOString().slice(0, 10)) E.push('Passport-এর validity কমপক্ষে ৬ মাস হতে হবে।');
    }
    if (val('passport_issue_place').length < 3) E.push('Place of issue দিন।');
  }
  if (n === 3) {
    if (!val('visa_type')) E.push('Visa type select করুন।');
    if (!val('entry_type')) E.push('Entry type select করুন।');
    if (val('purpose_detail').length < 10) E.push('Purpose of visit বিস্তারিত লিখুন (কমপক্ষে ১০ অক্ষর)।');
    if (!val('arrival_date')) E.push('Arrival date দিন।');
    if (!val('departure_date')) E.push('Departure date দিন।');
    if (val('arrival_date') && val('departure_date') && val('departure_date') < val('arrival_date')) E.push('Departure date, arrival-এর পর হতে হবে।');
  }
  if (n === 4) {
    if (!val('visa_center')) E.push('Visa center select করুন।');
    if (!val('pref_earliest')) E.push('Preferred earliest date দিন।');
    if (!val('pref_latest')) E.push('Preferred latest date দিন।');
    if (val('pref_earliest') && val('pref_latest') && val('pref_latest') < val('pref_earliest')) E.push('Latest date, earliest-এর পর হতে হবে।');
  }
  if (n === 5) {
    if (!fileOf('photo')) E.push('Passport size photo upload করুন।');
    if (!fileOf('passport_bio')) E.push('Passport bio-page scan upload করুন।');
  }
  if (n === 6) {
    if (!S.cfg.bkash_number) E.push('Payment details এখনো available নেই — পরে চেষ্টা করুন।');
    if (!val('payment_amount') || +val('payment_amount') <= 0) E.push('Paid amount দিন।');
    if (val('payment_trx_id').length < 8) E.push('bKash Transaction ID দিন (bKash app-এর "Transaction ID")।');
    if (!val('payment_date')) E.push('Payment date/time দিন।');
    const from = val('payment_from_number').replace(/[\s-]/g, '');
    if (!/^(\+?88)?01[3-9]\d{8}$/.test(from)) E.push('যে bKash number-এর থেকে পাঠালেন সেটা দিন (01XXXXXXXXX)।');
    if (!document.querySelector('[name=consent1]').checked) E.push('প্রথম consent tick করুন।');
    if (!document.querySelector('[name=consent2]').checked) E.push('দ্বিতীয় consent tick করুন।');
  }
  return E;
}

async function move(dir) {
  if (dir === 1) {
    const errs = validateStep(S.step);
    const box = document.getElementById('wizErrors');
    if (errs.length) { box.innerHTML = `<div class="errors">${errs.join('<br>')}</div>`; return; }
    if (S.step === S.total) { await submitApp(); return; }
    showStep(S.step + 1);
  } else {
    if (S.step > 1) showStep(S.step - 1);
  }
  document.getElementById('wizCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function submitApp() {
  const form = document.getElementById('wizForm');
  const fd = new FormData(form);
  const btn = document.getElementById('btnNext');
  btn.disabled = true; btn.textContent = 'Submitting…';
  try {
    const r = await fetch('/api/public/apply', { method: 'POST', body: fd });
    const j = await r.json();
    if (!r.ok) { document.getElementById('wizErrors').innerHTML = `<div class="errors">${j.error || 'Error'}</div>`; return; }
    S.ref = j.app_ref;
    document.getElementById('wizardCard').hidden = true;
    const sc = document.getElementById('successCard');
    sc.hidden = false;
    document.getElementById('successRef').textContent = j.app_ref;
    document.getElementById('successTotal').textContent = 'BDT ' + j.total;
    sc.scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    document.getElementById('wizErrors').innerHTML = `<div class="errors">Network error — আবার চেষ্টা করুন।</div>`;
  } finally { btn.disabled = false; }
}

function resetWizard() {
  document.getElementById('wizForm').reset();
  document.getElementById('photoPrev').innerHTML = '';
  document.getElementById('successCard').hidden = true;
  document.getElementById('wizardCard').hidden = false;
  showStep(1);
  document.getElementById('wizardCard').scrollIntoView({ behavior: 'smooth' });
}
function copyRef() { navigator.clipboard.writeText(S.ref || '').catch(() => {}); }
function copyBk() { navigator.clipboard.writeText(S.cfg.bkash_number || '').catch(() => {}); }

init();
