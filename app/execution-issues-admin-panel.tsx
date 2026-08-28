"use client";

import { useCallback, useEffect, useState } from "react";

type Comment = { id: string; authorName: string | null; body: string; createdAt: string };
type Issue = { id: string; reasonCode: string; comment: string | null; status: string; createdAt: string; mechanicName: string; vehicleLabel: string; plateNumber: string | null; workDescription: string; comments: Comment[] };
type Mechanic = { id: string; name: string; locationId: string };
type Post = { id: string; name: string; locationId: string };

const reasonLabels: Record<string, string> = {
  VEHICLE_NOT_PRESENT: "Автомобіль відсутній на СТО", VEHICLE_NOT_HANDED_OVER: "Автомобіль не передано", BAY_OCCUPIED: "Пост зайнятий", EQUIPMENT_UNAVAILABLE: "Немає обладнання", EQUIPMENT_BROKEN: "Обладнання несправне", PARTS_UNAVAILABLE: "Немає запчастин або матеріалів", ASSISTANCE_REQUIRED: "Потрібна допомога механіка", ALREADY_IN_PROGRESS: "Роботу вже виконує інший механік", INCORRECT_ASSIGNMENT_DATA: "Неправильні дані завдання", LICENSE_PLATE_MISMATCH: "Номер не збігається", TIME_UNAVAILABLE: "Не встигаю вчасно", OTHER: "Інша причина",
};

export function ExecutionIssuesAdminPanel() {
  const [items, setItems] = useState<Issue[]>([]);
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [selectedMechanic, setSelectedMechanic] = useState<Record<string, string>>({});
  const [selectedPost, setSelectedPost] = useState<Record<string, string>>({});
  const [rescheduleStart, setRescheduleStart] = useState<Record<string, string>>({});
  const [rescheduleEnd, setRescheduleEnd] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/cabinet/execution-issues", { cache: "no-store", credentials: "include" });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося завантажити звернення");
    setItems(body.items || []); setMechanics(body.mechanics || []); setPosts(body.posts || []);
  }, []);

  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Не вдалося завантажити звернення")); }, [load]);

  async function resolve(issue: Issue, resolutionType: string) {
    const resolutionComment = window.prompt("Коментар адміністратора:", "")?.trim() || "";
    if (["HELP", "REASSIGN", "RESCHEDULE", "REQUEST_CLARIFICATION", "CANCEL"].includes(resolutionType) && resolutionComment.length < 3) { setError("Для цього рішення потрібен коментар."); return; }
    const start = rescheduleStart[issue.id]; const end = rescheduleEnd[issue.id];
    if (resolutionType === "RESCHEDULE" && (!start || !end)) { setError("Вкажіть новий час початку та завершення."); return; }
    setBusy(`${issue.id}:${resolutionType}`); setError("");
    try {
      const response = await fetch("/api/cabinet/execution-issues", { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ issueId: issue.id, resolutionType, resolutionComment, mechanicId: resolutionType === "REASSIGN" ? selectedMechanic[issue.id] : resolutionType === "RESCHEDULE" ? selectedMechanic[issue.id] || undefined : undefined, postId: resolutionType === "RESCHEDULE" ? selectedPost[issue.id] || undefined : undefined, plannedStartAt: resolutionType === "RESCHEDULE" ? new Date(start).toISOString() : undefined, plannedEndAt: resolutionType === "RESCHEDULE" ? new Date(end).toISOString() : undefined }) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося застосувати рішення");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося застосувати рішення"); }
    finally { setBusy(null); }
  }

  if (!items.length && !error) return null;
  return <section style={{ marginTop: 18, padding: 20, border: "1px solid #f2c46d", borderRadius: 16, background: "#fffaf0" }} aria-label="Потребує рішення адміністратора">
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}><div><p className="eyebrow">ВИКОНАННЯ РОБІТ</p><h2 style={{ margin: 0 }}>Потребує рішення адміністратора</h2><p className="muted">Ці роботи залишаються за механіком, доки ви не приймете рішення.</p></div><strong style={{ padding: "6px 10px", borderRadius: 999, background: "#f5cf7e" }}>{items.length}</strong></div>
    {error && <p style={{ color: "#b42318", fontWeight: 700 }}>{error}</p>}
    <div style={{ display: "grid", gap: 12, marginTop: 14 }}>{items.map((issue) => <article key={issue.id} style={{ padding: 14, borderRadius: 12, background: "white", border: "1px solid #eadfbd" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><div><strong>{issue.vehicleLabel} · {issue.plateNumber || "Без номера"}</strong><div style={{ color: "#59636d", marginTop: 4 }}>{issue.workDescription} · механік: {issue.mechanicName}</div></div><small>{new Date(issue.createdAt).toLocaleString("uk-UA")}</small></div>
      <p style={{ margin: "10px 0 4px", fontWeight: 700 }}>{reasonLabels[issue.reasonCode] || issue.reasonCode}</p>{issue.comment && <p style={{ margin: 0, color: "#59636d" }}>{issue.comment}</p>}
      {issue.comments?.length > 0 && <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #eee" }}>{issue.comments.slice(-2).map((comment) => <small key={comment.id} style={{ display: "block", color: "#59636d" }}><b>{comment.authorName || "Користувач"}:</b> {comment.body}</small>)}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}><button type="button" disabled={Boolean(busy)} onClick={() => void resolve(issue, "KEEP_CURRENT_MECHANIC")}>Залишити механіку</button><button type="button" disabled={Boolean(busy)} onClick={() => void resolve(issue, "HELP")}>Допомогти</button><button type="button" disabled={Boolean(busy)} onClick={() => void resolve(issue, "REQUEST_CLARIFICATION")}>Повернути на уточнення</button><button type="button" disabled={Boolean(busy)} onClick={() => void resolve(issue, "CANCEL")}>Скасувати</button></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 8, marginTop: 10 }}><label style={{ display: "grid", gap: 4, fontSize: 12 }}>Новий механік<select value={selectedMechanic[issue.id] || ""} onChange={(event) => setSelectedMechanic((current) => ({ ...current, [issue.id]: event.target.value }))}><option value="">Оберіть механіка</option>{mechanics.map((mechanic) => <option value={mechanic.id} key={mechanic.id}>{mechanic.name}</option>)}</select></label><button type="button" disabled={Boolean(busy) || !selectedMechanic[issue.id]} onClick={() => void resolve(issue, "REASSIGN")}>Передати іншому механіку</button></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 8, marginTop: 10 }}><label style={{ display: "grid", gap: 4, fontSize: 12 }}>Початок<input type="datetime-local" value={rescheduleStart[issue.id] || ""} onChange={(event) => setRescheduleStart((current) => ({ ...current, [issue.id]: event.target.value }))} /></label><label style={{ display: "grid", gap: 4, fontSize: 12 }}>Завершення<input type="datetime-local" value={rescheduleEnd[issue.id] || ""} onChange={(event) => setRescheduleEnd((current) => ({ ...current, [issue.id]: event.target.value }))} /></label><label style={{ display: "grid", gap: 4, fontSize: 12 }}>Пост<select value={selectedPost[issue.id] || ""} onChange={(event) => setSelectedPost((current) => ({ ...current, [issue.id]: event.target.value }))}><option value="">Оберіть пост</option>{posts.map((post) => <option value={post.id} key={post.id}>{post.name}</option>)}</select></label><button type="button" disabled={Boolean(busy) || !rescheduleStart[issue.id] || !rescheduleEnd[issue.id]} onClick={() => void resolve(issue, "RESCHEDULE")}>Перенести роботу</button></div>
    </article>)}</div>
  </section>;
}
