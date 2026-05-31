import React, { useEffect, useRef, useState } from "https://esm.sh/react@18.2.0";
import { createRoot } from "https://esm.sh/react-dom@18.2.0/client";
import htm from "https://esm.sh/htm@3.1.1";
import {
  Bell,
  Check,
  Download,
  FilePlus2,
  LogOut,
  Mail,
  PenLine,
  RotateCcw,
  Send,
  ShieldCheck,
  Upload,
} from "https://esm.sh/lucide-react@0.468.0";

const html = htm.bind(React.createElement);
const DEMO_ADMIN = { email: "hr@example.com", name: "HR 관리자" };
const STORAGE_KEY = "hr-signature-mvp";
const SUPABASE_URL = window.__HR_SIGN_SUPABASE_URL__ || "";
const SUPABASE_ANON_KEY = window.__HR_SIGN_SUPABASE_ANON_KEY__ || "";

const emptyState = {
  campaigns: [],
  recipients: [],
  submissions: [],
  auditLogs: [],
  emailLogs: [],
};

function nowIso() {
  return new Date().toISOString();
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function shortId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseCsv(text) {
  const rows = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(",").map((cell) => cell.trim()));
  const [header = [], ...items] = rows;
  const normalized = header.map((cell) => cell.toLowerCase());
  const pick = (row, names, fallbackIndex) => {
    const index = names.map((name) => normalized.indexOf(name)).find((idx) => idx >= 0);
    return row[index ?? fallbackIndex] || "";
  };
  return items
    .map((row) => ({
      name: pick(row, ["name", "이름"], 0),
      email: pick(row, ["email", "이메일"], 1),
      employeeNo: pick(row, ["employee_no", "employee number", "사번"], 2),
      department: pick(row, ["department", "부서"], 3),
      title: pick(row, ["title", "position", "직책"], 4),
    }))
    .filter((item) => item.name && item.email);
}

function toCsv(rows) {
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return rows.map((row) => row.map(escape).join(",")).join("\n");
}

function downloadText(filename, text, mime = "text/csv;charset=utf-8") {
  const blob = new Blob(["\uFEFF", text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function routeTo(path) {
  window.location.hash = path;
}

function useHashRoute() {
  const [route, setRoute] = useState(window.location.hash.replace(/^#/, "") || "/login");
  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash.replace(/^#/, "") || "/login");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  return route;
}

function createLocalRepository() {
  const load = () => JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || emptyState;
  const save = (state) => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  return {
    async listCampaigns() {
      const state = load();
      return state.campaigns.map((campaign) => ({
        ...campaign,
        recipients: state.recipients.filter((recipient) => recipient.campaignId === campaign.id),
      }));
    },
    async getCampaign(id) {
      const state = load();
      const campaign = state.campaigns.find((item) => item.id === id);
      if (!campaign) return null;
      return {
        ...campaign,
        recipients: state.recipients.filter((recipient) => recipient.campaignId === id),
      };
    },
    async createCampaign(input) {
      const state = load();
      const documentHash = await sha256(`${input.title}\n${input.description}\n${input.documentContent}`);
      const campaign = {
        id: shortId("camp"),
        title: input.title,
        description: input.description,
        dueAt: input.dueAt,
        documentContent: input.documentContent,
        documentVersion: "v1",
        originalDocumentHash: documentHash,
        status: "draft",
        createdBy: DEMO_ADMIN.email,
        createdAt: nowIso(),
      };
      const recipients = input.recipients.map((person) => ({
        id: shortId("rcpt"),
        campaignId: campaign.id,
        name: person.name,
        email: person.email,
        employeeNo: person.employeeNo,
        department: person.department,
        title: person.title,
        status: "not_sent",
        tokenId: shortId("tok"),
        token: randomToken(),
        tokenExpiresAt: input.dueAt ? new Date(`${input.dueAt}T23:59:59`).toISOString() : null,
        sentAt: null,
        viewedAt: null,
        signedAt: null,
        createdAt: nowIso(),
      }));
      save({
        ...state,
        campaigns: [campaign, ...state.campaigns],
        recipients: [...recipients, ...state.recipients],
      });
      return campaign;
    },
    async markSent(campaignId, reminder = false) {
      const state = load();
      const sentAt = nowIso();
      const recipients = state.recipients.map((recipient) =>
        recipient.campaignId === campaignId && recipient.status !== "signed"
          ? { ...recipient, status: "sent", sentAt: recipient.sentAt || sentAt }
          : recipient,
      );
      const targetRecipients = recipients.filter((recipient) => recipient.campaignId === campaignId && recipient.status !== "signed");
      const emailLogs = targetRecipients.map((recipient) => ({
        id: shortId("mail"),
        campaignId,
        recipientId: recipient.id,
        toEmail: recipient.email,
        type: reminder ? "reminder" : "initial",
        provider: "demo",
        status: "queued",
        providerMessageId: null,
        errorMessage: null,
        createdAt: sentAt,
      }));
      save({ ...state, recipients, emailLogs: [...emailLogs, ...state.emailLogs] });
    },
    async getSigningRequest(token) {
      const state = load();
      const recipient = state.recipients.find((item) => item.token === token);
      if (!recipient) return null;
      const campaign = state.campaigns.find((item) => item.id === recipient.campaignId);
      const expired = recipient.tokenExpiresAt && new Date(recipient.tokenExpiresAt) < new Date();
      if (expired && recipient.status !== "signed") recipient.status = "expired";
      if (recipient.status === "sent") {
        recipient.status = "viewed";
        recipient.viewedAt = recipient.viewedAt || nowIso();
        save(state);
      }
      return campaign ? { campaign, recipient: { ...recipient, token: undefined } } : null;
    },
    async submitSignature(token, signatureDataUrl, consentChecked) {
      const state = load();
      const recipient = state.recipients.find((item) => item.token === token);
      if (!recipient) throw new Error("유효하지 않은 서명 링크입니다.");
      if (recipient.status === "signed") throw new Error("이미 제출된 서명입니다.");
      if (recipient.tokenExpiresAt && new Date(recipient.tokenExpiresAt) < new Date()) throw new Error("만료된 서명 링크입니다.");
      if (!consentChecked) throw new Error("본인 확인 동의가 필요합니다.");
      const campaign = state.campaigns.find((item) => item.id === recipient.campaignId);
      const submittedAt = nowIso();
      const signatureHash = await sha256(signatureDataUrl);
      const completedHash = await sha256(`${campaign.originalDocumentHash}:${recipient.id}:${signatureHash}:${submittedAt}`);
      const submission = {
        id: shortId("sub"),
        campaignId: campaign.id,
        recipientId: recipient.id,
        signatureImageDataUrl: signatureDataUrl,
        signatureImagePath: null,
        signatureImageHash: signatureHash,
        completedDocumentHash: completedHash,
        consentChecked,
        submittedAt,
        locked: true,
      };
      const audit = {
        id: shortId("audit"),
        campaignId: campaign.id,
        recipientId: recipient.id,
        submissionId: submission.id,
        signerName: recipient.name,
        signerEmail: recipient.email,
        employeeNo: recipient.employeeNo,
        department: recipient.department,
        submittedAt,
        ipAddress: null,
        userAgent: navigator.userAgent,
        consentChecked,
        documentVersion: campaign.documentVersion,
        originalDocumentHash: campaign.originalDocumentHash,
        signatureImageHash: signatureHash,
        completedDocumentHash: completedHash,
        tokenId: recipient.tokenId,
        editAfterCompletionAllowed: false,
        createdAt: submittedAt,
      };
      const recipients = state.recipients.map((item) =>
        item.id === recipient.id ? { ...item, status: "signed", signedAt: submittedAt, token: null } : item,
      );
      save({
        ...state,
        recipients,
        submissions: [submission, ...state.submissions],
        auditLogs: [audit, ...state.auditLogs],
      });
      return submission;
    },
    async exportRows(campaignId) {
      const state = load();
      const recipients = state.recipients.filter((item) => item.campaignId === campaignId);
      return recipients.map((recipient) => {
        const submission = state.submissions.find((item) => item.recipientId === recipient.id);
        return {
          ...recipient,
          signatureImageHash: submission?.signatureImageHash || "",
          completedDocumentHash: submission?.completedDocumentHash || "",
        };
      });
    },
  };
}

function createRepository() {
  // TODO(security): 실서비스에서는 Supabase RPC와 Edge Function으로 토큰 검증, 이메일 발송, IP 기록, 서명 이미지 저장을 서버에서 처리해야 한다.
  // 이 MVP는 환경값이 없으면 localStorage 데모 저장소를 사용한다.
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return createLocalRepository();
  return createLocalRepository();
}

const repository = createRepository();

function IconButton({ icon, children, className = "", ...props }) {
  return html`<button className=${`button ${className}`} ...${props}>${icon}${children && html`<span>${children}</span>`}</button>`;
}

function Layout({ session, onLogout, children }) {
  return html`
    <main className="shell">
      <aside className="nav">
        <div className="brand">
          <span className="brand-mark">HR</span>
          <div>
            <strong>전자서명 수집</strong>
            <small>사내 테스트 MVP</small>
          </div>
        </div>
        <nav>
          <button className="nav-link" onClick=${() => routeTo("/admin")}>대시보드</button>
          <button className="nav-link" onClick=${() => routeTo("/campaigns/new")}>요청 생성</button>
        </nav>
        <div className="nav-footer">
          <small>${session?.email || "로그인 필요"}</small>
          ${session &&
          html`<button className="text-button" onClick=${onLogout}><${LogOut} size=${16} /> 로그아웃</button>`}
        </div>
      </aside>
      <section className="content">${children}</section>
    </main>
  `;
}

function Login({ onLogin }) {
  const [email, setEmail] = useState(DEMO_ADMIN.email);
  return html`
    <main className="login-screen">
      <section className="login-panel">
        <div className="brand large">
          <span className="brand-mark">HR</span>
          <div>
            <strong>전자서명 수집</strong>
            <small>관리자 로그인</small>
          </div>
        </div>
        <h1>서명 요청을 만들고 진행률을 관리합니다.</h1>
        <p>데모에서는 이메일만 입력하면 로그인됩니다. Supabase Auth 연결 후 관리자 권한 검증을 추가하세요.</p>
        <label>
          관리자 이메일
          <input value=${email} onInput=${(event) => setEmail(event.target.value)} />
        </label>
        <${IconButton} icon=${html`<${ShieldCheck} size=${18} />`} onClick=${() => onLogin({ ...DEMO_ADMIN, email })}>
          로그인
        <//>
      </section>
    </main>
  `;
}

function Stat({ label, value }) {
  return html`<div className="stat"><strong>${value}</strong><span>${label}</span></div>`;
}

function Dashboard() {
  const [campaigns, setCampaigns] = useState([]);
  useEffect(() => {
    repository.listCampaigns().then(setCampaigns);
  }, []);
  const totals = campaigns.reduce(
    (acc, campaign) => {
      acc.total += campaign.recipients.length;
      acc.signed += campaign.recipients.filter((item) => item.status === "signed").length;
      return acc;
    },
    { total: 0, signed: 0 },
  );
  return html`
    <header className="page-header">
      <div>
        <p className="eyebrow">관리자 대시보드</p>
        <h1>서명 요청 현황</h1>
      </div>
      <${IconButton} icon=${html`<${FilePlus2} size=${18} />`} onClick=${() => routeTo("/campaigns/new")}>요청 생성<//>
    </header>
    <section className="stats">
      <${Stat} label="전체 대상자" value=${totals.total} />
      <${Stat} label="서명 완료" value=${totals.signed} />
      <${Stat} label="미완료" value=${Math.max(totals.total - totals.signed, 0)} />
    </section>
    <section className="table-section">
      <div className="section-title">
        <h2>서명 요청 목록</h2>
      </div>
      <div className="campaign-list">
        ${campaigns.length === 0 &&
        html`<div className="empty">아직 생성된 서명 요청이 없습니다. CSV 대상자 목록으로 첫 요청을 만들어 보세요.</div>`}
        ${campaigns.map((campaign) => {
          const total = campaign.recipients.length;
          const signed = campaign.recipients.filter((item) => item.status === "signed").length;
          const percent = total ? Math.round((signed / total) * 100) : 0;
          return html`
            <button className="campaign-row" onClick=${() => routeTo(`/campaigns/${campaign.id}`)}>
              <div>
                <strong>${campaign.title}</strong>
                <span>${campaign.description || "설명 없음"}</span>
              </div>
              <div className="progress-cell">
                <span>${signed}/${total} 완료</span>
                <div className="progress"><i style=${{ width: `${percent}%` }} /></div>
              </div>
              <span className="badge">${percent}%</span>
            </button>
          `;
        })}
      </div>
    </section>
  `;
}

function NewCampaign() {
  const [form, setForm] = useState({ title: "", description: "", dueAt: "", documentContent: "" });
  const [recipients, setRecipients] = useState([]);
  const [manual, setManual] = useState({ name: "", email: "", employeeNo: "", department: "", title: "" });
  const [saving, setSaving] = useState(false);

  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const canSave = form.title && form.documentContent && recipients.length > 0;

  async function handleCsv(file) {
    if (!file) return;
    const text = await file.text();
    setRecipients((prev) => [...prev, ...parseCsv(text)]);
  }

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    const campaign = await repository.createCampaign({ ...form, recipients });
    routeTo(`/campaigns/${campaign.id}`);
  }

  return html`
    <header className="page-header">
      <div>
        <p className="eyebrow">서명 요청 생성</p>
        <h1>문서와 대상자를 등록합니다.</h1>
      </div>
      <${IconButton} icon=${html`<${Check} size=${18} />`} disabled=${!canSave || saving} onClick=${save}>
        저장
      <//>
    </header>
    <div className="form-grid">
      <section className="panel">
        <h2>문서 정보</h2>
        <label>제목<input value=${form.title} onInput=${(event) => update("title", event.target.value)} /></label>
        <label>설명<textarea rows="3" value=${form.description} onInput=${(event) => update("description", event.target.value)} /></label>
        <label>마감일<input type="date" value=${form.dueAt} onInput=${(event) => update("dueAt", event.target.value)} /></label>
        <label>문서 내용<textarea rows="12" value=${form.documentContent} onInput=${(event) => update("documentContent", event.target.value)} /></label>
        <p className="hint">문서 원문 해시는 제목, 설명, 문서 내용을 기준으로 생성됩니다.</p>
      </section>
      <section className="panel">
        <h2>대상자</h2>
        <label className="file-drop">
          <${Upload} size=${20} />
          CSV 업로드
          <input type="file" accept=".csv,text/csv" onChange=${(event) => handleCsv(event.target.files?.[0])} />
        </label>
        <div className="manual-grid">
          ${["name", "email", "employeeNo", "department", "title"].map((key) => {
            const labels = { name: "이름", email: "이메일", employeeNo: "사번", department: "부서", title: "직책" };
            return html`<input placeholder=${labels[key]} value=${manual[key]} onInput=${(event) => setManual((prev) => ({ ...prev, [key]: event.target.value }))} />`;
          })}
        </div>
        <button
          className="button secondary"
          disabled=${!manual.name || !manual.email}
          onClick=${() => {
            setRecipients((prev) => [...prev, manual]);
            setManual({ name: "", email: "", employeeNo: "", department: "", title: "" });
          }}
        >
          직접 추가
        </button>
        <div className="recipient-preview">
          ${recipients.map((person, index) => html`<span key=${`${person.email}-${index}`}>${person.name} · ${person.email}</span>`)}
        </div>
      </section>
    </div>
  `;
}

function CampaignDetail({ id }) {
  const [campaign, setCampaign] = useState(null);
  const reload = () => repository.getCampaign(id).then(setCampaign);
  useEffect(reload, [id]);
  if (!campaign) return html`<div className="empty">서명 요청을 찾을 수 없습니다.</div>`;

  const signed = campaign.recipients.filter((item) => item.status === "signed").length;
  const rows = campaign.recipients;

  async function send(reminder = false) {
    await repository.markSent(campaign.id, reminder);
    reload();
  }

  async function exportCsv() {
    const exportRows = await repository.exportRows(campaign.id);
    const csv = toCsv([
      ["이름", "이메일", "사번", "부서", "직책", "상태", "발송시각", "열람시각", "서명시각", "서명이미지해시", "완료문서해시"],
      ...exportRows.map((row) => [
        row.name,
        row.email,
        row.employeeNo,
        row.department,
        row.title,
        row.status,
        row.sentAt,
        row.viewedAt,
        row.signedAt,
        row.signatureImageHash,
        row.completedDocumentHash,
      ]),
    ]);
    downloadText(`${campaign.title}-서명현황.csv`, csv);
  }

  return html`
    <header className="page-header">
      <div>
        <p className="eyebrow">요청 상세</p>
        <h1>${campaign.title}</h1>
        <p>${campaign.description || "설명 없음"} · 마감 ${campaign.dueAt || "-"}</p>
      </div>
      <div className="actions">
        <${IconButton} icon=${html`<${Send} size=${18} />`} onClick=${() => send(false)}>발송<//>
        <${IconButton} icon=${html`<${Bell} size=${18} />`} className="secondary" onClick=${() => send(true)}>리마인드<//>
        <${IconButton} icon=${html`<${Download} size=${18} />`} className="secondary" onClick=${exportCsv}>CSV<//>
      </div>
    </header>
    <section className="stats">
      <${Stat} label="대상자" value=${rows.length} />
      <${Stat} label="서명 완료" value=${signed} />
      <${Stat} label="미완료" value=${rows.length - signed} />
    </section>
    <section className="panel">
      <h2>대상자 리스트</h2>
      <div className="data-table">
        <div className="data-head"><span>대상자</span><span>부서/직책</span><span>상태</span><span>개인 링크</span></div>
        ${rows.map((recipient) => html`
          <div className="data-row">
            <span><strong>${recipient.name}</strong><small>${recipient.email} · ${recipient.employeeNo}</small></span>
            <span>${recipient.department || "-"} / ${recipient.title || "-"}</span>
            <span className=${`status ${recipient.status}`}>${statusLabel(recipient.status)}</span>
            <button className="link-button" onClick=${() => navigator.clipboard.writeText(`${location.origin}${location.pathname}#/sign/${recipient.token}`)}>
              링크 복사
            </button>
          </div>
        `)}
      </div>
    </section>
  `;
}

function statusLabel(status) {
  return {
    not_sent: "미발송",
    sent: "발송완료",
    viewed: "열람",
    signed: "서명완료",
    expired: "만료",
  }[status] || status;
}

function SignaturePad({ onChange }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111827";
  }, []);

  const point = (event) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const source = event.touches?.[0] || event;
    return {
      x: ((source.clientX - rect.left) / rect.width) * canvas.width,
      y: ((source.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const start = (event) => {
    event.preventDefault();
    drawing.current = true;
    const ctx = canvasRef.current.getContext("2d");
    const p = point(event);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };

  const move = (event) => {
    if (!drawing.current) return;
    event.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const p = point(event);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    setEmpty(false);
    onChange(canvasRef.current.toDataURL("image/png"));
  };

  const stop = () => {
    drawing.current = false;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    setEmpty(true);
    onChange("");
  };

  return html`
    <div className="signature-box">
      <canvas
        ref=${canvasRef}
        width="720"
        height="240"
        onMouseDown=${start}
        onMouseMove=${move}
        onMouseUp=${stop}
        onMouseLeave=${stop}
        onTouchStart=${start}
        onTouchMove=${move}
        onTouchEnd=${stop}
        aria-label="수기 서명 입력 영역"
      />
      ${empty && html`<span className="sign-placeholder">마우스 또는 터치로 서명</span>`}
      <button className="text-button" onClick=${clear}><${RotateCcw} size=${16} /> 지우기</button>
    </div>
  `;
}

function SignerPage({ token }) {
  const [request, setRequest] = useState(null);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(false);
  const [signature, setSignature] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    repository.getSigningRequest(token).then((result) => {
      if (!result) setError("유효하지 않거나 만료된 서명 링크입니다.");
      setRequest(result);
    });
  }, [token]);

  async function submit() {
    try {
      setSubmitting(true);
      await repository.submitSignature(token, signature, consent);
      routeTo("/complete");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (error) return html`<main className="sign-screen"><section className="sign-panel"><h1>서명할 수 없습니다.</h1><p>${error}</p></section></main>`;
  if (!request) return html`<main className="sign-screen"><section className="sign-panel"><p>서명 요청을 불러오는 중입니다.</p></section></main>`;
  const { campaign, recipient } = request;
  return html`
    <main className="sign-screen">
      <section className="sign-panel wide">
        <div className="sign-header">
          <div>
            <p className="eyebrow">본인 전자서명</p>
            <h1>${campaign.title}</h1>
            <p>${campaign.description || ""}</p>
          </div>
          <span className="badge">문서 ${campaign.documentVersion}</span>
        </div>
        <div className="document-body">${campaign.documentContent}</div>
        <div className="identity-box">
          <strong>${recipient.name}</strong>
          <span>${recipient.email} · ${recipient.employeeNo || "사번 없음"} · ${recipient.department || "부서 없음"} · ${recipient.title || "직책 없음"}</span>
        </div>
        <label className="check-row">
          <input type="checkbox" checked=${consent} onChange=${(event) => setConsent(event.target.checked)} />
          본인은 위 내용을 확인했고 본인 의사로 서명합니다.
        </label>
        <${SignaturePad} onChange=${setSignature} />
        <${IconButton}
          icon=${html`<${PenLine} size=${18} />`}
          disabled=${!consent || !signature || submitting}
          onClick=${submit}
        >
          서명 제출
        <//>
        <p className="hint">제출 후 수정할 수 없습니다. 감사로그에는 제출 시각, user-agent, 문서/서명 해시가 저장됩니다.</p>
      </section>
    </main>
  `;
}

function Complete() {
  return html`
    <main className="sign-screen">
      <section className="sign-panel">
        <div className="complete-icon"><${Check} size=${34} /></div>
        <h1>서명이 제출되었습니다.</h1>
        <p>제출된 서명은 수정할 수 없습니다. 필요한 경우 HR 담당자에게 문의하세요.</p>
      </section>
    </main>
  `;
}

function App() {
  const route = useHashRoute();
  const [session, setSession] = useState(() => JSON.parse(sessionStorage.getItem("hr-admin-session") || "null"));
  const login = (user) => {
    sessionStorage.setItem("hr-admin-session", JSON.stringify(user));
    setSession(user);
    routeTo("/admin");
  };
  const logout = () => {
    sessionStorage.removeItem("hr-admin-session");
    setSession(null);
    routeTo("/login");
  };

  if (route.startsWith("/sign/")) return html`<${SignerPage} token=${route.replace("/sign/", "")} />`;
  if (route === "/complete") return html`<${Complete} />`;
  if (!session || route === "/login") return html`<${Login} onLogin=${login} />`;

  let content = html`<${Dashboard} />`;
  if (route === "/campaigns/new") content = html`<${NewCampaign} />`;
  if (route.startsWith("/campaigns/")) content = html`<${CampaignDetail} id=${route.replace("/campaigns/", "")} />`;

  return html`<${Layout} session=${session} onLogout=${logout}>${content}<//>`;
}

createRoot(document.getElementById("root")).render(html`<${App} />`);
