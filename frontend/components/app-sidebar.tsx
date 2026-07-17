"use client"

import * as React from "react"

import { NavMain } from "@/components/nav-main"
import { NavProjects } from "@/components/nav-projects"
import { NavAIThreads } from "@/components/ai-interaction-group/nav-ai-threads"
import { NavUser } from "@/components/nav-user"
import { TeamSwitcher } from "@/components/team-switcher"
import { AIConversation } from "@/components/ai-interaction-group/ai-conversation"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  AudioWave01Icon,
  BookOpen02Icon,
  BubbleChatIcon,
  CommandIcon,
  ComputerTerminalIcon,
  CropIcon,
  LayoutBottomIcon,
  MapsIcon,
  PieChartIcon,
  RoboticIcon,
  Settings05Icon,
} from "@hugeicons/core-free-icons"
import { route } from "@/lib/routes/routes"
import { useAIChatStore } from "@/lib/ai-chat-modal/ai-chat"

// This is sample data.
const data = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "/avatars/shadcn.jpg",
  },
  teams: [
    {
      name: "Cybernetics Neuro",
      logo: <HugeiconsIcon icon={LayoutBottomIcon} strokeWidth={2} />,
      url: "#",

      plan: "Enterprise",
    },
    {
      name: "Acme Corp.",
      logo: <HugeiconsIcon icon={AudioWave01Icon} strokeWidth={2} />,
      plan: "Startup",
    },
    {
      name: "Evil Corp.",
      logo: <HugeiconsIcon icon={CommandIcon} strokeWidth={2} />,
      plan: "Free",
    },
  ],
  navMain: [
    {
      title: "Playground",
      url: "#",
      icon: <HugeiconsIcon icon={ComputerTerminalIcon} strokeWidth={2} />,
      items: [
        { title: "History", url: "#" },
        { title: "Starred", url: "#" },
        { title: "Settings", url: "#" },
      ],
    },
    {
      title: "Models",
      url: "#",
      icon: <HugeiconsIcon icon={RoboticIcon} strokeWidth={2} />,
      items: [
        { title: "Genesis", url: "#" },
        { title: "Explorer", url: "#" },
        { title: "Quantum", url: "#" },
      ],
    },
    {
      title: "Documentation",
      url: "#",
      icon: <HugeiconsIcon icon={BookOpen02Icon} strokeWidth={2} />,
      items: [
        { title: "Introduction", url: "#" },
        { title: "Get Started", url: "#" },
        { title: "Tutorials", url: "#" },
        { title: "Changelog", url: "#" },
      ],
    },
    {
      title: "Settings",
      url: "#",
      icon: <HugeiconsIcon icon={Settings05Icon} strokeWidth={2} />,
      items: [
        { title: "General", url: "#" },
        { title: "Team", url: "#" },
        { title: "Billing", url: "#" },
        { title: "Limits", url: "#" },
      ],
    },
  ],
  projects: [
    {
      name: "Design Engineering",
      url: "#",
      icon: <HugeiconsIcon icon={CropIcon} strokeWidth={2} />,
    },
    {
      name: "Sales & Marketing",
      url: "#",
      icon: <HugeiconsIcon icon={PieChartIcon} strokeWidth={2} />,
    },
    {
      name: "Travel",
      url: "#",
      icon: <HugeiconsIcon icon={MapsIcon} strokeWidth={2} />,
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const isChatOpen = useAIChatStore((s) => s.isChatOpen)
  const openChat   = useAIChatStore((s) => s.openChat)
  const closeChat  = useAIChatStore((s) => s.closeChat)

  return (
    <>
      <Sidebar collapsible="icon" {...props}>
        <SidebarHeader>
          <TeamSwitcher teams={data.teams} />
        {/*<SidebarMenuItem>*/}
        {/*  <SidebarMenuButton*/}
        {/*    onClick={openChat}*/}
        {/*    tooltip="AI Chat"*/}
        {/*  >*/}
        {/*    <HugeiconsIcon icon={BubbleChatIcon} strokeWidth={2} />*/}
        {/*    <span>AI Chat</span>*/}
        {/*  </SidebarMenuButton>*/}
        {/*</SidebarMenuItem>*/}
        </SidebarHeader>
        <SidebarContent>
          <NavMain items={route.navMain} />
          <NavProjects projects={route.projects} />
          <NavAIThreads />
        </SidebarContent>
        <SidebarFooter>
          <NavUser />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <Dialog open={isChatOpen} onOpenChange={(open) => open ? openChat() : closeChat()}>
        <DialogContent
          className="flex h-[85vh] min-w-5xl flex-col gap-0 p-0"
          showCloseButton
        >
          <DialogTitle className="sr-only">AI Chat</DialogTitle>
          <AIConversation className="flex-1 overflow-hidden rounded-4xl" />
        </DialogContent>
      </Dialog>
    </>
  )
}
