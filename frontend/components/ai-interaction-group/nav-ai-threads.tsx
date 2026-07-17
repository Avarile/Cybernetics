"use client"

import { useCallback, useEffect, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Add01Icon, BubbleChatIcon, Delete01Icon } from "@hugeicons/core-free-icons"
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@/components/ui/sidebar"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  useAIChatStore,
  useAIThreads,
  useAIActiveThread,
  useAIActiveAgent,
} from "@/lib/ai-chat-modal/ai-chat"
import type { IThread } from "@/lib/interfaces/mastra.interface"

export function NavAIThreads() {
  const { fetchAgents, fetchThreads, loadThread, deleteThread, resetConversation, openChat } = useAIChatStore()
  const threads       = useAIThreads()
  const activeThread  = useAIActiveThread()
  const activeAgentId = useAIActiveAgent()
  const isLoading     = useAIChatStore((s) => s.isLoadingThreads)
  const firstAgentId  = useAIChatStore((s) => Object.keys(s.agents)[0] ?? null)

  const [pendingDelete, setPendingDelete] = useState<IThread | null>(null)

  useEffect(() => {
    fetchAgents()
    fetchThreads()
  }, [fetchAgents, fetchThreads])

  const handleSelect = useCallback(
    (thread: IThread) => {
      const agentId = thread.agentId ?? activeAgentId ?? firstAgentId
      if (!agentId) return
      loadThread(agentId, thread.id)
      openChat()
    },
    [loadThread, openChat, activeAgentId, firstAgentId],
  )

  const handleNewChat = useCallback(() => {
    resetConversation()
    openChat()
  }, [resetConversation, openChat])

  const handleDeleteConfirm = useCallback(async () => {
    if (!pendingDelete) return
    const agentId = pendingDelete.agentId ?? activeAgentId ?? firstAgentId ?? 'master-agent'
    await deleteThread(agentId, pendingDelete.id)
    setPendingDelete(null)
  }, [pendingDelete, activeAgentId, firstAgentId, deleteThread])

  return (
    <>
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>AI Conversations</SidebarGroupLabel>

        <SidebarGroupAction onClick={handleNewChat} title="New conversation">
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          <span className="sr-only">New conversation</span>
        </SidebarGroupAction>

        <SidebarMenu>
          {isLoading ? (
            <>
              <SidebarMenuSkeleton />
              <SidebarMenuSkeleton />
              <SidebarMenuSkeleton />
            </>
          ) : threads.length === 0 ? (
            <SidebarMenuItem>
              <SidebarMenuButton disabled className="text-sidebar-foreground/50 text-xs italic">
                <HugeiconsIcon icon={BubbleChatIcon} strokeWidth={2} />
                <span>No conversations yet</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : (
            threads.map((thread) => (
              <SidebarMenuItem key={thread.id}>
                <SidebarMenuButton
                  isActive={activeThread?.id === thread.id}
                  onClick={() => handleSelect(thread)}
                  title={thread.title ?? "Untitled conversation"}
                >
                  <HugeiconsIcon icon={BubbleChatIcon} strokeWidth={2} />
                  <span className="truncate">
                    {thread.title ?? "Untitled conversation"}
                  </span>
                </SidebarMenuButton>

                <SidebarMenuAction
                  showOnHover
                  onClick={(e) => {
                    e.stopPropagation()
                    setPendingDelete(thread)
                  }}
                  title="Delete conversation"
                  className="text-muted-foreground hover:text-destructive"
                >
                  <HugeiconsIcon icon={Delete01Icon} strokeWidth={2} />
                  <span className="sr-only">Delete</span>
                </SidebarMenuAction>
              </SidebarMenuItem>
            ))
          )}
        </SidebarMenu>
      </SidebarGroup>

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{pendingDelete?.title ?? "Untitled conversation"}&rdquo; will be permanently
              deleted and cannot be recovered.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
