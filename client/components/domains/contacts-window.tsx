"use client"

import { useState } from "react"
import { DataTable } from "@/components/data-table/data-table"
import { useWorkspaceStore } from "@/stores/workspace.store"
import { contactsConfig, type Contact } from "./contacts.config"

export function ContactsWindow() {
  const openWindow = useWorkspaceStore((s) => s.openWindow)
  const [refreshToken, setRefreshToken] = useState(0)

  return (
    <DataTable
      config={contactsConfig}
      refreshToken={refreshToken}
      onOpen={(row: Contact) =>
        openWindow({
          kind: "record-detail",
          title: row.displayName,
          singletonKey: `contacts:detail:${row.id}`,
          props: { domain: "contacts", id: row.id, endpoint: "/contacts" },
        })
      }
      onCreate={() =>
        openWindow({
          kind: "record-create",
          title: "New contact",
          singletonKey: "contacts:create",
          props: { domain: "contacts", endpoint: "/contacts" },
        })
      }
      onEdit={(row) =>
        openWindow({
          kind: "record-edit",
          title: `Edit ${row.displayName}`,
          singletonKey: `contacts:edit:${row.id}`,
          props: { domain: "contacts", id: row.id, endpoint: "/contacts" },
        })
      }
      onDelete={(rows) =>
        openWindow({
          kind: "confirm",
          title: rows.length === 1 ? "Delete contact" : "Delete contacts",
          modal: true,
          singletonKey: `confirm:contacts:${rows.map((r) => r.id).join(",")}`,
          props: {
            message: `Delete ${rows.length} contact${rows.length === 1 ? "" : "s"}?`,
            confirmLabel: "Delete",
            destructive: true,
            ids: rows.map((r) => r.id),
            endpoint: "/contacts",
            onDone: () => setRefreshToken((n) => n + 1),
          },
        })
      }
    />
  )
}
