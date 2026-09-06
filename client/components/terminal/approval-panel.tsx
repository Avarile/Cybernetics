"use client"

import { useState } from "react"
import { ShieldAlertIcon } from "lucide-react"
import { CodeBlock } from "@/components/ai-elements/code-block"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import type { PendingApproval } from "@/lib/agent/reducer"
import type { ActionType } from "@/lib/agent/types"

const ACTION_LABEL: Record<ActionType, string> = {
  send_email: "Send an email",
  db_write: "Write to the database",
  external_api: "Call an external service",
  other: "Perform an action",
}

/**
 * The human-in-the-loop gate. The agent has paused mid-turn and will not act
 * until this is decided.
 *
 * Built from `Alert` rather than ai-elements' `Confirmation`: that component
 * renders nothing unless it is handed an `approval` object describing a
 * decision *already made*, while `ConfirmationRequest` only shows before one
 * exists — the two conditions cannot both hold, so the request UI is
 * unreachable. Its accepted/rejected views are usable once a decision lands,
 * and are worth revisiting when approval history is rendered.
 */
export function ApprovalPanel({
  approval,
  pending,
  onDecide,
}: {
  approval: PendingApproval
  pending: boolean
  onDecide: (approved: boolean) => void
}) {
  const [showPayload, setShowPayload] = useState(false)

  return (
    <Alert className="border-amber-500/40 bg-amber-500/5">
      <ShieldAlertIcon className="size-4 text-amber-600" />
      <AlertTitle className="text-sm">Approval required</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-foreground">{approval.title}</span>
          <span className="text-xs text-muted-foreground">
            {ACTION_LABEL[approval.actionType]} · {approval.toolName}
          </span>
        </div>

        {Object.keys(approval.payload).length > 0 && (
          <div>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => setShowPayload((v) => !v)}
            >
              {showPayload ? "Hide details" : "Show what it will do"}
            </Button>
            {showPayload && (
              <div className="mt-2 max-h-56 overflow-auto">
                <CodeBlock
                  code={JSON.stringify(approval.payload, null, 2)}
                  language="json"
                />
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button size="sm" disabled={pending} onClick={() => onDecide(true)}>
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => onDecide(false)}
          >
            Reject
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}
