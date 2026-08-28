"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Link2,
  Plus,
  Search,
  ShieldCheck,
  UserCog,
  UsersRound,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { securityPermissionGroups } from "@/lib/security-permissions";
import { formatSouthAfricaDate } from "@/lib/south-africa-time";

type Invitation = {
  id: string;
  name: string;
  email: string;
  roleName: string;
  facilityCode: string | null;
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  expiresAt: string;
  createdAt: string;
};

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  scope: string;
  active?: boolean;
  permissions: string[];
};

type RoleOption = { name: string; permissions: string[] };
type FacilityOption = { name: string; code: string };

const roles = [
  ["Organisation owner", "Full portfolio control"],
  ["Facility manager", "Facility operations and approvals"],
  ["Sales / leasing", "Leads, reservations and move-ins"],
  ["Collections", "Past-due workflows and access actions"],
  ["Finance", "Ledger, payments, close and reports"],
  ["Auditor / read only", "Governed view and export access"],
];

export function UsersWorkspace() {
  const [open, setOpen] = useState(false);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [persistedUsers, setPersistedUsers] = useState<UserRow[]>([]);
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([]);
  const [facilities, setFacilities] = useState<FacilityOption[]>([]);
  const [invitationSent, setInvitationSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [permissionUser, setPermissionUser] = useState<UserRow | null>(null);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);

  const load = useCallback(async () => {
    const response = await fetch("/api/v1/invitations", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    setInvitations(payload.data);
    setPersistedUsers(payload.users);
    setRoleOptions(payload.roles ?? []);
    setFacilities(payload.facilities ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/invitations", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!cancelled && payload) {
          setInvitations(payload.data);
          setPersistedUsers(payload.users);
          setRoleOptions(payload.roles ?? []);
          setFacilities(payload.facilities ?? []);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submitInvitation(formData: FormData) {
    setBusy(true);
    setError("");
    setInvitationSent(false);
    const response = await fetch("/api/v1/invitations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        email: formData.get("email"),
        roleName: formData.get("roleName"),
        facilityCode: formData.get("facilityCode"),
      }),
    });
    const payload = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(
        payload.error?.message ?? "The invitation could not be created.",
      );
      return;
    }
    setInvitationSent(payload.data.delivery === "SENT");
    await load();
  }

  async function revoke(id: string) {
    const response = await fetch(`/api/v1/invitations/${id}`, {
      method: "DELETE",
    });
    if (response.ok) await load();
  }

  async function updateUser(
    id: string,
    changes: { active?: boolean; roleName?: string },
  ) {
    setError("");
    const response = await fetch(`/api/v1/users/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(changes),
    });
    if (!response.ok) {
      const payload = await response.json();
      setError(payload.error?.message ?? "The user could not be updated.");
      return;
    }
    await load();
  }

  async function savePermissions() {
    if (!permissionUser) return;
    setBusy(true);
    setError("");
    const response = await fetch(
      `/api/v1/users/${permissionUser.id}/permissions`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ permissions: selectedPermissions }),
      },
    );
    const payload = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(payload.error?.message ?? "Permissions could not be saved.");
      return;
    }
    setPermissionUser(null);
    await load();
  }

  const users = persistedUsers;
  const pending = invitations.filter(
    (invitation) => invitation.status === "PENDING",
  );

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Access administration"
        title="Users & permissions"
        description="Manage employees, facility scope, security levels, approval thresholds and service accounts."
        action={
          <button
            className="button button-primary"
            onClick={() => {
              setOpen(true);
              setInvitationSent(false);
              setError("");
            }}
          >
            <Plus size={16} /> Add employee
          </button>
        }
      />
      <section className="summary-strip">
        {[
          [
            "Active employees",
            String(users.filter((user) => user.active !== false).length),
          ],
          ["Pending invites", String(pending.length)],
          ["Security levels", String(roleOptions.length)],
          ["Access model", "Role based"],
        ].map(([label, value]) => (
          <div className="summary-cell" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>
      {pending.length > 0 ? (
        <section className="panel">
          <div className="hub-heading">
            <div>
              <h2>Pending invitations</h2>
              <p>Links expire automatically after seven days.</p>
            </div>
            <span>{pending.length} pending</span>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Invitee</th>
                  <th>Role</th>
                  <th>Expires</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pending.map((invitation) => (
                  <tr key={invitation.id}>
                    <td className="primary-cell">
                      {invitation.name}
                      <span className="secondary-cell">{invitation.email}</span>
                    </td>
                    <td>{invitation.roleName}</td>
                    <td>
                      {formatSouthAfricaDate(invitation.expiresAt)}
                    </td>
                    <td>
                      <button
                        className="text-button text-button-danger"
                        onClick={() => revoke(invitation.id)}
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      <section className="panel">
        <div className="toolbar">
          <label className="toolbar-search">
            <Search size={16} />
            <input placeholder="Search users, roles or facilities…" />
          </label>
          <span>
            <UserCog size={16} /> Database-backed access
          </span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Security level</th>
                <th>Store access</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.email}>
                  <td className="primary-cell">
                    {user.name}
                    <span className="secondary-cell">{user.email}</span>
                  </td>
                  <td>
                    <select
                      aria-label={`Role for ${user.name}`}
                      value={user.role}
                      onChange={(event) =>
                        updateUser(user.id, { roleName: event.target.value })
                      }
                    >
                      {user.role.startsWith("Custom access · ") ? (
                        <option value={user.role}>Custom access</option>
                      ) : null}
                      {(roleOptions.length
                        ? roleOptions.map((role) => role.name)
                        : roles.map(([role]) => role)
                      ).map((role) => (
                        <option key={role}>{role}</option>
                      ))}
                    </select>
                  </td>
                  <td>{user.scope}</td>
                  <td>
                    <StatusPill
                      tone={user.active === false ? "neutral" : "positive"}
                    >
                      {user.active === false ? "Inactive" : "Active"}
                    </StatusPill>
                  </td>
                  <td>
                    <div className="user-actions">
                      <button
                        className="text-button"
                        onClick={() => {
                          setPermissionUser(user);
                          setSelectedPermissions(user.permissions);
                          setError("");
                        }}
                      >
                        Edit permissions
                      </button>
                      <button
                        className={
                          user.active === false
                            ? "text-button"
                            : "text-button text-button-danger"
                        }
                        onClick={() =>
                          updateUser(user.id, { active: user.active === false })
                        }
                      >
                        {user.active === false ? "Reactivate" : "Deactivate"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel panel-spacious">
        <div className="panel-heading">
          <div>
            <h2>Security roles</h2>
            <p className="panel-subtitle">
              Role-based permissions with facility scope and approval limits.
            </p>
          </div>
          <ShieldCheck className="positive-icon" />
        </div>
        <div className="role-grid">
          {(roleOptions.length
            ? roleOptions.map((role) => [
                role.name,
                role.permissions.includes("*")
                  ? "Full organisation control"
                  : `${role.permissions.length} assigned permissions`,
              ])
            : roles
          ).map(([role, description]) => (
            <article className="role-card" key={role}>
              <UsersRound size={18} />
              <div>
                <strong>{role}</strong>
                <p>{description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {open ? (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-title"
          >
            <button
              className="modal-close"
              onClick={() => setOpen(false)}
              aria-label="Close invitation dialog"
            >
              <X size={18} />
            </button>
            <p className="eyebrow">Secure invitation</p>
            <h2 id="invite-title">Add an employee</h2>
            <p className="modal-copy">
              Choose the employee&apos;s security level and store access. A
              secure invitation expires in seven days.
            </p>
            {invitationSent ? (
              <div className="invite-success">
                <span>
                  <Check size={18} /> Invitation created
                </span>
                <p>
                  The secure invitation was sent to the recipient by the
                  configured email provider.
                </p>
                <button
                  className="button button-secondary"
                  onClick={() => {
                    setInvitationSent(false);
                    setError("");
                  }}
                >
                  Invite another user
                </button>
              </div>
            ) : (
              <form action={submitInvitation} className="invite-form">
                <label>
                  Full name
                  <input
                    name="name"
                    required
                    minLength={2}
                    autoComplete="name"
                  />
                </label>
                <label>
                  Email address
                  <input
                    name="email"
                    required
                    type="email"
                    autoComplete="email"
                  />
                </label>
                <label>
                  Security level
                  <select name="roleName" defaultValue="Facility manager">
                    {(roleOptions.length
                      ? roleOptions.map((role) => role.name)
                      : roles.map(([role]) => role)
                    ).map((role) => (
                      <option key={role}>{role}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Store access
                  <select name="facilityCode" defaultValue="">
                    <option value="">All stores</option>
                    {facilities.map((facility) => (
                      <option value={facility.code} key={facility.code}>
                        {facility.name}
                      </option>
                    ))}
                  </select>
                </label>
                {error ? <p className="form-error">{error}</p> : null}
                <button
                  className="button button-primary"
                  disabled={busy}
                  type="submit"
                >
                  <Link2 size={16} />
                  {busy ? "Creating…" : "Create invitation"}
                </button>
              </form>
            )}
          </div>
        </div>
      ) : null}
      {permissionUser ? (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal-card permission-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="permissions-title"
          >
            <button
              className="modal-close"
              onClick={() => setPermissionUser(null)}
              aria-label="Close permissions dialog"
            >
              <X size={18} />
            </button>
            <p className="eyebrow">Individual access</p>
            <h2 id="permissions-title">
              Permissions for {permissionUser.name}
            </h2>
            <p className="modal-copy">
              Tick what this employee may access. Saving creates a custom
              security level for this employee and signs out their existing
              sessions.
            </p>
            <div className="permission-groups">
              {securityPermissionGroups.map((group) => (
                <fieldset key={group.label}>
                  <legend>{group.label}</legend>
                  {group.permissions.map(([key, label]) => (
                    <label className="check-label" key={key}>
                      <input
                        type="checkbox"
                        checked={selectedPermissions.includes(key)}
                        onChange={(event) =>
                          setSelectedPermissions((current) =>
                            event.target.checked
                              ? [...current, key]
                              : current.filter(
                                  (permission) => permission !== key,
                                ),
                          )
                        }
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="form-footer">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setPermissionUser(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button button-primary"
                disabled={busy}
                onClick={savePermissions}
              >
                {busy ? "Saving…" : "Save permissions"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
