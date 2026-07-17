"use client"

import { Dialog, DialogContent } from "@/components/ui/dialog"
import {ForceGraphDynamic} from "@/app/data-links-modal/components/ForceGraphDynamic";

interface ForceModalProps {
  open: boolean
  onClose: () => void
}

export function ForceModal({ open, onClose }: ForceModalProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} >
      <DialogContent
          showCloseButton={false}
        className="min-w-7xl w-[80vw] h-[70vh] p-0 overflow-hidden flex flex-col"
      >
        <ForceGraphDynamic />
      </DialogContent>
    </Dialog>
  )
}
