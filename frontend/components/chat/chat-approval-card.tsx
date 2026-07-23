'use client'
import { Confirmation, ConfirmationAction, ConfirmationActions, ConfirmationRequest, ConfirmationTitle } from '@/components/ai-elements/chatbot/confirmation'
import type { UiApproval } from '@/lib/interfaces/chat.interface'

export function ChatApprovalCard({ approval, onRespond }: { approval: UiApproval; onRespond: (approved: boolean) => void }) {
  return (
    <Confirmation state="approval-requested" approval={{ id: approval.approvalId }}>
      <ConfirmationRequest>
        <ConfirmationTitle>{approval.title}</ConfirmationTitle>
        <ConfirmationActions>
          <ConfirmationAction variant="outline" onClick={() => onRespond(false)}>Reject</ConfirmationAction>
          <ConfirmationAction onClick={() => onRespond(true)}>Approve</ConfirmationAction>
        </ConfirmationActions>
      </ConfirmationRequest>
    </Confirmation>
  )
}
