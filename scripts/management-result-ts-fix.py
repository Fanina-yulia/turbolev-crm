from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        if new in text:
            return
        raise SystemExit(f"missing anchor {label} in {path}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "app/api/management/plans/[id]/accept/route.ts",
    "    return NextResponse.json({ ok: true, ...result });\n",
    "    return NextResponse.json(result);\n",
    "accept duplicate ok",
)

replace_once(
    "app/api/management/plans/route.ts",
    "      return NextResponse.json({ ok: true, ...result });\n",
    "      return NextResponse.json(result);\n",
    "plans duplicate ok",
)

replace_once(
    "app/management-result-panel.tsx",
    "      const body = await response.json().catch(() => null) as ResultPayload | { error?: string } | null;\n      if (!response.ok || !body || body.ok !== true) throw new Error(body && \"error\" in body && body.error ? body.error : \"Не вдалося завантажити план.\");\n",
    "      const body = await response.json().catch(() => null) as ResultPayload | { ok?: false; error?: string } | null;\n      if (!response.ok || !body || !(\"ok\" in body) || body.ok !== true) throw new Error(body && \"error\" in body && body.error ? body.error : \"Не вдалося завантажити план.\");\n",
    "result payload guard",
)

replace_once(
    "src/services/management-bonus.service.ts",
    "      details: preliminary.details,\n",
    "      details: toPrismaJson(preliminary.details ?? {}),\n",
    "bonus json input",
)
