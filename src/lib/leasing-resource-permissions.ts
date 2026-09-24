export const leasingResourcePermissions = {
  facilities: { read: "inventory.view", create: "inventory.manage", change: "inventory.manage" },
  "unit-types": { read: "inventory.view", create: "inventory.manage", change: "inventory.manage" },
  units: { read: "inventory.view", create: "inventory.manage", change: "inventory.manage" },
  customers: { read: "operations.view", create: "operations.manage", change: "operations.manage" },
  leads: { read: "leads.view", create: "leads.create", change: "operations.manage" },
  reservations: { read: "reservations.manage", create: "reservations.manage", change: "reservations.manage" },
} as const;
