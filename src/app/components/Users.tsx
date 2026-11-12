import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, ShieldCheck, UserX } from 'lucide-react';
import { adminListUsers, adminUpdateUser, timeAgo, type UserAccount, type UserRole } from '../lib/api';
import { ROLE_LABELS } from '../lib/permissions';

const ROLE_HELP: Record<UserRole, string> = {
  admin: 'Everything, including approving users',
  owner: 'Settings, thresholds, register / edit / remove horses',
  caretaker: 'View everything, handle alerts',
  veterinarian: 'View everything, handle alerts',
};

export function Users({ myId }: { myId: string }) {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers(await adminListUsers());
    } catch (e) {
      const message = (e as Error).message;
      setNotice({
        kind: 'error',
        text: /admin_list_users|schema cache|function/i.test(message)
          ? 'The Users page needs the database update. Run supabase/05_roles_and_approval.sql in the Supabase SQL Editor.'
          : message,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const change = async (user: UserAccount, changes: { role?: UserRole; approved?: boolean }, message: string) => {
    setBusyId(user.id);
    setNotice(null);
    try {
      await adminUpdateUser(user.id, changes);
      await load();
      setNotice({ kind: 'ok', text: message });
    } catch (e) {
      setNotice({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  };

  const pending = users.filter((u) => !u.approved);
  const approved = users.filter((u) => u.approved);

  const roleSelect = (user: UserAccount) => (
    <select
      value={user.role}
      disabled={busyId === user.id || user.id === myId}
      onChange={(e) =>
        change(user, { role: e.target.value as UserRole }, `${user.full_name || user.email} is now ${ROLE_LABELS[e.target.value]}.`)
      }
      className="min-h-12 rounded-lg border-2 border-gray-300 bg-white px-3 text-lg disabled:bg-gray-100"
      aria-label={`Role for ${user.email}`}
    >
      {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
        <option key={role} value={role}>{ROLE_LABELS[role]}</option>
      ))}
    </select>
  );

  return (
    <div className="space-y-4 p-3 sm:space-y-6 sm:p-6">
      <div>
        <h1 className="text-3xl sm:text-4xl">Users</h1>
        <p className="mt-2 text-xl text-gray-600">Approve new accounts and choose what each person can do.</p>
      </div>

      {notice && (
        <div className={`rounded-xl border-2 p-4 text-lg ${notice.kind === 'ok' ? 'border-green-300 bg-green-50 text-green-800' : 'border-red-300 bg-red-50 text-red-800'}`}>
          {notice.text}
        </div>
      )}

      {/* Roles explained */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {(Object.keys(ROLE_HELP) as UserRole[]).map((role) => (
          <div key={role} className="rounded-xl border-2 border-gray-200 bg-white p-4">
            <div className="text-xl font-semibold">{ROLE_LABELS[role]}</div>
            <div className="text-lg text-gray-600">{ROLE_HELP[role]}</div>
          </div>
        ))}
      </div>

      {loading && <p className="text-2xl text-gray-600">Loading users…</p>}

      {/* Waiting for approval */}
      {!loading && (
        <section className="rounded-2xl border-2 border-yellow-500 bg-yellow-50 p-4 sm:p-6">
          <h2 className="mb-4 flex items-center gap-2 text-2xl">
            <Clock className="h-7 w-7 text-yellow-700" /> Waiting for approval ({pending.length})
          </h2>
          {pending.length === 0 ? (
            <p className="text-xl text-gray-600">No new accounts waiting.</p>
          ) : (
            <div className="space-y-3">
              {pending.map((user) => (
                <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-yellow-300 bg-white p-4">
                  <div>
                    <div className="text-xl">{user.full_name || '(no name)'}</div>
                    <div className="text-lg text-gray-600">{user.email} · signed up {timeAgo(user.created_at)}</div>
                    <div className="mt-1 inline-block rounded-lg bg-yellow-100 px-3 py-1 text-base text-yellow-900">
                      Signed up as <strong>{ROLE_LABELS[user.role]}</strong>. Change it below if needed.
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {roleSelect(user)}
                    <button
                      type="button"
                      disabled={busyId === user.id}
                      onClick={() => change(user, { approved: true }, `${user.full_name || user.email} can now sign in as ${ROLE_LABELS[user.role]}.`)}
                      className="flex min-h-12 items-center gap-2 rounded-lg bg-green-600 px-5 text-lg text-white hover:bg-green-700 disabled:opacity-60"
                    >
                      <CheckCircle2 className="h-5 w-5" /> Approve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Active users */}
      {!loading && (
        <section className="rounded-2xl border-2 border-gray-200 bg-white p-4 sm:p-6">
          <h2 className="mb-4 flex items-center gap-2 text-2xl">
            <ShieldCheck className="h-7 w-7 text-green-700" /> Active users ({approved.length})
          </h2>
          <div className="space-y-3">
            {approved.map((user) => (
              <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-gray-200 p-4">
                <div>
                  <div className="text-xl">
                    {user.full_name || '(no name)'} {user.id === myId && <span className="text-base text-gray-500">(you)</span>}
                  </div>
                  <div className="text-lg text-gray-600">
                    {user.email} · last sign-in {user.last_sign_in_at ? timeAgo(user.last_sign_in_at) : 'never'}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {roleSelect(user)}
                  {user.id !== myId && (
                    <button
                      type="button"
                      disabled={busyId === user.id}
                      onClick={() => change(user, { approved: false }, `${user.full_name || user.email} can no longer see the system.`)}
                      className="flex min-h-12 items-center gap-2 rounded-lg border-2 border-red-300 px-4 text-lg text-red-700 hover:bg-red-50 disabled:opacity-60"
                    >
                      <UserX className="h-5 w-5" /> Remove access
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-base text-gray-500">You can't change your own role or remove your own access, so the system always keeps an admin.</p>
        </section>
      )}
    </div>
  );
}
