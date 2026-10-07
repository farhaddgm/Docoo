'use client';
import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useState, type FormEvent } from 'react';
import {
  isGmail,
  type Account,
  type AccountRole,
  type LoginMethod,
  type AccessLevel,
} from '@docoo/contracts';

type Locale = 'fa' | 'en';
interface Workspace {
  id: string;
  code: string;
  name: string;
}
interface Identity {
  user: { id: string; email: string; role: AccountRole; isOwner: boolean };
  workspaces: Workspace[];
}
interface Page {
  items: Account[];
  total: number;
  page: number;
  totalPages: number;
  workspaces: Workspace[];
}
interface AccessRow {
  id: string;
  name: string;
  isCreator: boolean;
  effective: AccessLevel | null;
  granted: AccessLevel | null;
}
interface Grants {
  topics: AccessRow[];
  projects: AccessRow[];
}
const labels = {
  fa: {
    users: 'مدیریت کاربران',
    google: 'ورود با جیمیل',
    description: 'حساب‌ها، نقش‌ها و روش ورود را مدیریت کنید.',
    googleDescription: 'فقط جیمیل‌هایی که مالک مجاز کرده است می‌توانند با گوگل وارد شوند.',
    back: 'نمای کلی',
    login: 'ورود',
    denied: 'اجازهٔ دسترسی به این بخش را ندارید.',
    loading: 'در حال بارگذاری…',
    search: 'جست‌وجوی نام یا ایمیل',
    add: 'افزودن حساب',
    edit: 'ویرایش',
    remove: 'حذف حساب',
    revoke: 'حذف دسترسی جیمیل',
    deleteConfirm:
      'این حساب برای همیشه حذف می‌شود. داده‌های پروژه و سوابق تصمیم‌ها باقی می‌مانند. ادامه می‌دهید؟',
    revokeConfirm: 'ورود با گوگل حذف می‌شود. اگر حساب رمز ندارد غیرفعال می‌شود. ادامه می‌دهید؟',
    name: 'نام',
    email: 'ایمیل',
    role: 'نقش',
    method: 'روش ورود',
    active: 'فعال',
    inactive: 'غیرفعال',
    password: 'رمز عبور',
    passwordHint: '۸ تا ۱۲۸ نویسه؛ در ویرایش، خالی بگذارید تا رمز فعلی حفظ شود.',
    passwordRequired: 'برای این روش ورود، رمز عبور لازم است.',
    workspaces: 'فضاهای کاری',
    save: 'ذخیره',
    cancel: 'انصراف',
    owner: 'مالک',
    lastLogin: 'آخرین ورود',
    created: 'تاریخ ایجاد',
    none: 'بدون دسترسی',
    view: 'فقط مشاهده',
    write: 'ویرایش',
    access: 'دسترسی به حوزه‌ها و پروژه‌ها',
    topic: 'حوزه‌ها',
    project: 'پروژه‌ها',
    creator: 'سازنده',
    previous: 'قبلی',
    next: 'بعدی',
    empty: 'حسابی پیدا نشد.',
    saved: 'تغییرات ذخیره شد.',
    failure: 'عملیات انجام نشد؛ ورودی‌ها و دسترسی را بررسی کنید.',
    self: 'حساب خودتان',
    googleOnly: 'این حساب رمز عبور ندارد.',
    ownerOnly: 'تغییر روش ورود با جیمیل فقط در اختیار مالک است.',
    gmailOnly: 'ورود گوگل فقط برای آدرس جیمیل است.',
    super_admin: 'مدیر',
    editor: 'ویرایشگر',
    viewer: 'مشاهده‌گر',
    PASSWORD: 'فقط رمز عبور',
    GOOGLE: 'فقط جیمیل',
    BOTH: 'جیمیل و رمز عبور',
  },
  en: {
    users: 'Manage users',
    google: 'Gmail sign-in',
    description: 'Manage accounts, roles and sign-in methods.',
    googleDescription: 'Google sign-in is limited to Gmail accounts approved by the owner.',
    back: 'Overview',
    login: 'Sign in',
    denied: 'You do not have access to this section.',
    loading: 'Loading…',
    search: 'Search name or email',
    add: 'Add account',
    edit: 'Edit',
    remove: 'Delete account',
    revoke: 'Revoke Google access',
    deleteConfirm:
      'Permanently delete this account? Project data and decision history will remain.',
    revokeConfirm: 'Remove Google sign-in? An account without a password will be deactivated.',
    name: 'Name',
    email: 'Email',
    role: 'Role',
    method: 'Sign-in method',
    active: 'Active',
    inactive: 'Inactive',
    password: 'Password',
    passwordHint: '8–128 characters. Leave blank when editing to keep the current password.',
    passwordRequired: 'A password is required for this sign-in method.',
    workspaces: 'Workspaces',
    save: 'Save',
    cancel: 'Cancel',
    owner: 'Owner',
    lastLogin: 'Last sign-in',
    created: 'Created',
    none: 'No access',
    view: 'View only',
    write: 'Edit',
    access: 'Topic and project access',
    topic: 'Topics',
    project: 'Projects',
    creator: 'Creator',
    previous: 'Previous',
    next: 'Next',
    empty: 'No accounts found.',
    saved: 'Changes saved.',
    failure: 'The operation failed. Check the details and permissions.',
    self: 'Your account',
    googleOnly: 'This account has no password.',
    ownerOnly: 'Only the owner can change Gmail sign-in.',
    gmailOnly: 'Google sign-in requires a Gmail address.',
    super_admin: 'Administrator',
    editor: 'Editor',
    viewer: 'Viewer',
    PASSWORD: 'Password only',
    GOOGLE: 'Gmail only',
    BOTH: 'Gmail and password',
  },
};
async function api<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${url}`, {
    method,
    cache: 'no-store',
    credentials: 'same-origin',
    ...(body !== undefined
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as {
      detail?: string;
      message?: string;
    };
    throw new Error(problem.detail ?? problem.message ?? String(response.status));
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}
export function AccountsScreen({
  locale,
  googleOnly = false,
}: {
  locale: Locale;
  googleOnly?: boolean;
}) {
  const t = labels[locale];
  const base = googleOnly ? '/owner/google-access' : '/admin/users';
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [data, setData] = useState<Page | null>(null);
  const [denied, setDenied] = useState(false);
  const [guest, setGuest] = useState(false);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<{ user: Account | null } | null>(null);
  const [accessFor, setAccessFor] = useState<Account | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/auth/session', { cache: 'no-store', signal: controller.signal })
      .then(async (r) => {
        if (r.status === 401) {
          setGuest(true);
          return;
        }
        if (!r.ok) throw new Error();
        const value = (await r.json()) as Identity;
        setIdentity(value);
        setDenied(value.user.role !== 'super_admin' || (googleOnly && !value.user.isOwner));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(t.failure);
      });
    return () => controller.abort();
  }, [googleOnly, t.failure]);
  useEffect(() => {
    if (!identity || denied) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void api<Page>(`${base}?q=${encodeURIComponent(q)}&page=${page}`)
        .then((value) => {
          if (!cancelled) setData(value);
        })
        .catch(() => {
          if (!cancelled) setError(t.failure);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [identity, denied, base, q, page, revision, t.failure]);
  const reload = () => {
    setRevision((r) => r + 1);
    setNotice(t.saved);
    setError('');
  };
  async function remove(user: Account) {
    if (busy || !window.confirm(googleOnly ? t.revokeConfirm : t.deleteConfirm)) return;
    setBusy(true);
    try {
      await api(`${base}/${user.id}`, 'DELETE');
      reload();
    } catch {
      setError(t.failure);
    } finally {
      setBusy(false);
    }
  }
  if (guest)
    return (
      <main className="content">
        <p>{t.denied}</p>
        <Link href={`/${locale}/auth/login` as Route}>{t.login}</Link>
      </main>
    );
  if (denied)
    return (
      <main className="content">
        <p role="alert">{t.denied}</p>
        <Link href={`/${locale}`}>{t.back}</Link>
      </main>
    );
  return (
    <main className="content accounts-page" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="topbar">
        <div>
          <h1>{googleOnly ? t.google : t.users}</h1>
          <p>{googleOnly ? t.googleDescription : t.description}</p>
        </div>
        <Link href={`/${locale}`}>{t.back}</Link>
      </header>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice success">
          {notice}
        </p>
      )}
      {!data || !identity ? (
        <p role="status">{t.loading}</p>
      ) : (
        <>
          {googleOnly && (
            <p className="notice">
              {t.owner}: <span dir="ltr">{identity.user.email}</span>
            </p>
          )}
          <div className="accounts-toolbar">
            <label>
              <span>{t.search}</span>
              <input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <button className="primary-button" onClick={() => setEditing({ user: null })}>
              {t.add}
            </button>
          </div>
          <div className="card accounts-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t.name}</th>
                  <th>{t.role}</th>
                  <th>{t.method}</th>
                  <th>{t.active}</th>
                  <th>{t.lastLogin}</th>
                  <th>{t.created}</th>
                  <th>{t.edit}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.displayName}</strong>{' '}
                      {user.isOwner && <span className="status">{t.owner}</span>}
                      <div dir="ltr">{user.email}</div>
                    </td>
                    <td>{t[user.role]}</td>
                    <td>{t[user.loginMethod]}</td>
                    <td>{user.isActive ? t.active : t.inactive}</td>
                    <td>
                      {user.lastLoginAt
                        ? new Date(user.lastLoginAt).toLocaleString(
                            locale === 'fa' ? 'fa-IR' : 'en-US',
                          )
                        : '—'}
                    </td>
                    <td>
                      {new Date(user.createdAt).toLocaleDateString(
                        locale === 'fa' ? 'fa-IR' : 'en-US',
                      )}
                    </td>
                    <td>
                      <div className="accounts-actions">
                        <button
                          className="secondary-button"
                          disabled={user.isOwner && !identity.user.isOwner}
                          onClick={() => setEditing({ user })}
                        >
                          {t.edit}
                        </button>
                        {identity.user.isOwner && user.role !== 'super_admin' && (
                          <button className="secondary-button" onClick={() => setAccessFor(user)}>
                            {t.access}
                          </button>
                        )}
                        <button
                          className="secondary-button"
                          disabled={
                            busy || user.isOwner || (!googleOnly && user.id === identity.user.id)
                          }
                          onClick={() => void remove(user)}
                        >
                          {googleOnly ? t.revoke : t.remove}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.items.length && <p>{t.empty}</p>}
          </div>
          <div className="accounts-toolbar">
            <button
              className="secondary-button"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              {t.previous}
            </button>
            <span>
              {page} / {data.totalPages} · {data.total}
            </span>
            <button
              className="secondary-button"
              disabled={page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              {t.next}
            </button>
          </div>
          {editing && (
            <AccountForm
              locale={locale}
              user={editing.user}
              identity={identity}
              workspaces={data.workspaces}
              googleOnly={googleOnly}
              base={base}
              onClose={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                reload();
              }}
            />
          )}
          {accessFor && (
            <AccessDialog
              locale={locale}
              user={accessFor}
              workspaces={data.workspaces.filter((w) => accessFor.workspaceIds.includes(w.id))}
              onClose={() => setAccessFor(null)}
            />
          )}
        </>
      )}
    </main>
  );
}
function AccountForm({
  locale,
  user,
  identity,
  workspaces,
  googleOnly,
  base,
  onClose,
  onSaved,
}: {
  locale: Locale;
  user: Account | null;
  identity: Identity;
  workspaces: Workspace[];
  googleOnly: boolean;
  base: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = labels[locale];
  const [email, setEmail] = useState(user?.email ?? '');
  const [name, setName] = useState(user?.displayName ?? '');
  const [role, setRole] = useState<AccountRole>(user?.role ?? 'editor');
  const [method, setMethod] = useState<LoginMethod>(
    user?.loginMethod ?? (googleOnly ? 'GOOGLE' : 'PASSWORD'),
  );
  const [active, setActive] = useState(user?.isActive ?? true);
  const [password, setPassword] = useState('');
  const [selected, setSelected] = useState<string[]>(
    user?.workspaceIds ?? workspaces.map((w) => w.id),
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canChoose = identity.user.isOwner && isGmail(email);
  const self = user?.id === identity.user.id;
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (method !== 'GOOGLE' && !password && !user?.hasPassword) {
      setError(t.passwordRequired);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(user ? `${base}/${user.id}` : base, user ? 'PATCH' : 'POST', {
        ...(!user ? { email } : {}),
        displayName: name,
        role,
        loginMethod: method,
        isActive: undefined,
        ...(user ? { isActive: active } : {}),
        workspaceIds: selected,
        ...(method !== 'GOOGLE' && password ? { password } : {}),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account-modal-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-dialog-title"
        className="card account-dialog"
      >
        <h2 id="account-dialog-title">{user ? t.edit : t.add}</h2>
        <form className="auth-form" onSubmit={(event) => void save(event)}>
          <label htmlFor="account-email">{t.email}</label>
          <input
            id="account-email"
            type="email"
            dir="ltr"
            value={email}
            disabled={!!user}
            onChange={(e) => {
              setEmail(e.target.value);
              if (!isGmail(e.target.value) && !googleOnly) setMethod('PASSWORD');
            }}
            required
          />
          <label htmlFor="account-name">{t.name}</label>
          <input
            id="account-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            minLength={2}
            maxLength={100}
            required
          />
          <label htmlFor="account-role">{t.role}</label>
          <select
            id="account-role"
            value={role}
            disabled={self}
            onChange={(e) => setRole(e.target.value as AccountRole)}
          >
            {(['super_admin', 'editor', 'viewer'] as const).map((r) => (
              <option value={r} key={r}>
                {t[r]}
              </option>
            ))}
          </select>
          <label htmlFor="account-method">{t.method}</label>
          <select
            id="account-method"
            value={method}
            disabled={!canChoose}
            onChange={(e) => {
              setMethod(e.target.value as LoginMethod);
              setPassword('');
            }}
          >
            {(googleOnly
              ? (['GOOGLE', 'BOTH'] as const)
              : (['PASSWORD', 'GOOGLE', 'BOTH'] as const)
            ).map((m) => (
              <option key={m} value={m}>
                {t[m]}
              </option>
            ))}
          </select>
          {!canChoose && <p>{identity.user.isOwner ? t.gmailOnly : t.ownerOnly}</p>}
          {method !== 'GOOGLE' ? (
            <>
              <label htmlFor="account-password">{t.password}</label>
              <input
                id="account-password"
                type="password"
                dir="ltr"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                maxLength={128}
                required={!user?.hasPassword}
              />
              <p>{t.passwordHint}</p>
            </>
          ) : (
            <p>{t.googleOnly}</p>
          )}
          <fieldset>
            <legend>{t.workspaces}</legend>
            {workspaces.map((w) => (
              <label key={w.id} className="account-checkbox">
                <input
                  type="checkbox"
                  checked={selected.includes(w.id)}
                  onChange={(e) =>
                    setSelected((ids) =>
                      e.target.checked ? [...ids, w.id] : ids.filter((id) => id !== w.id),
                    )
                  }
                />
                {w.name}
              </label>
            ))}
          </fieldset>
          {user && (
            <label className="account-checkbox">
              <input
                type="checkbox"
                checked={active}
                disabled={self}
                onChange={(e) => setActive(e.target.checked)}
              />
              {t.active}
            </label>
          )}
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <div className="accounts-actions">
            <button type="submit" className="primary-button" disabled={busy || !selected.length}>
              {t.save}
            </button>
            <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>
              {t.cancel}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
function AccessDialog({
  locale,
  user,
  workspaces,
  onClose,
}: {
  locale: Locale;
  user: Account;
  workspaces: Workspace[];
  onClose: () => void;
}) {
  const t = labels[locale];
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? '');
  const [kind, setKind] = useState<'topics' | 'projects'>('topics');
  const [data, setData] = useState<Grants | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (workspaceId)
      void api<Grants>(`/owner/users/${user.id}/access?workspaceId=${workspaceId}`)
        .then((d) => {
          if (!cancelled) setData(d);
        })
        .catch(() => {
          if (!cancelled) setError(t.failure);
        });
    return () => {
      cancelled = true;
    };
  }, [user.id, workspaceId, t.failure]);
  async function change(row: AccessRow, value: string) {
    setBusy(true);
    setError('');
    try {
      await api(
        `/owner/users/${user.id}/access/${kind === 'topics' ? 'topic' : 'project'}/${row.id}`,
        'PUT',
        { workspaceId, access: value === 'NONE' ? null : value },
      );
      setData((current) =>
        current
          ? {
              ...current,
              [kind]: current[kind].map((item) =>
                item.id === row.id
                  ? { ...item, effective: value === 'NONE' ? null : (value as AccessLevel) }
                  : item,
              ),
            }
          : current,
      );
    } catch {
      setError(t.failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account-modal-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="access-dialog-title"
        className="card account-dialog"
      >
        <h2 id="access-dialog-title">
          {t.access} · {user.displayName}
        </h2>
        <label className="auth-form">
          {t.workspaces}
          <select
            value={workspaceId}
            onChange={(e) => {
              setData(null);
              setWorkspaceId(e.target.value);
            }}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <div className="accounts-actions">
          <button
            className="secondary-button"
            aria-pressed={kind === 'topics'}
            onClick={() => setKind('topics')}
          >
            {t.topic}
          </button>
          <button
            className="secondary-button"
            aria-pressed={kind === 'projects'}
            onClick={() => setKind('projects')}
          >
            {t.project}
          </button>
        </div>
        <label className="auth-form">
          {t.search}
          <input value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {!data ? (
          <p>{t.loading}</p>
        ) : (
          <ul className="account-access-list">
            {data[kind]
              .filter((row) => row.name.toLowerCase().includes(q.toLowerCase()))
              .map((row) => (
                <li key={row.id}>
                  <span>
                    {row.name} {row.isCreator && <small>{t.creator}</small>}
                  </span>
                  <select
                    aria-label={row.name}
                    value={row.effective ?? 'NONE'}
                    disabled={busy}
                    onChange={(e) => void change(row, e.target.value)}
                  >
                    {!row.isCreator && <option value="NONE">{t.none}</option>}
                    <option value="VIEW">{t.view}</option>
                    <option value="EDIT">{t.write}</option>
                  </select>
                </li>
              ))}
          </ul>
        )}
        <button className="secondary-button" onClick={onClose}>
          {t.cancel}
        </button>
      </section>
    </div>
  );
}
