"use client"

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,} from "@/components/ui/sidebar"
import {HugeiconsIcon} from "@hugeicons/react"
import {
    CheckmarkBadgeIcon,
    CreditCardIcon,
    LogoutIcon,
    NotificationIcon,
    SparklesIcon,
    UnfoldMoreIcon,
} from "@hugeicons/core-free-icons"
import {AnimatedThemeToggler} from "./animations/animated-theme-toggler"
import {useAuthStore, useIsAuthenticated, useUser} from "@/lib/state-management/auth.store"
import {useRouter} from "next/navigation"
import {useState} from "react"
import {Persona} from "@/components/ai-elements/voice/persona"
import MusicPlayer from "@/components/music-player"

import {Avatar, AvatarFallback} from "@/components/ui/avatar"
import {Shimmer} from "@/components/ai-elements/chatbot/shimmer";

export function NavUser() {
    const {isMobile} = useSidebar()
    const isAuthenticated = useIsAuthenticated()
    const user = useUser()
    const logout = useAuthStore((s) => s.logout)
    const router = useRouter()
    const [isPlaying, setIsPlaying] = useState(false)

    if (!isAuthenticated || !user) return null

    const displayName = user?.userName || "user"

    return (
        <SidebarMenu>
            <MusicPlayer onPlayingChange={setIsPlaying} showPersona/>
            <SidebarMenuItem>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <SidebarMenuButton
                            size="lg"
                            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                        >
                            <Avatar className="h-8 w-8 rounded-lg grayscale">
                                <Persona
                                    state={"thinking"}
                                    className="h-8 w-8"
                                />
                            </Avatar>
                            <div className="grid flex-1 text-left text-sm leading-tight">
                                <span className="truncate font-medium">{displayName}</span>
                                <span className="truncate text-xs">{user.email}</span>
                            </div>
                            <HugeiconsIcon
                                icon={UnfoldMoreIcon}
                                strokeWidth={2}
                                className="ml-auto size-4"
                            />
                        </SidebarMenuButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
                        side={isMobile ? "bottom" : "right"}
                        align="end"
                        sideOffset={4}
                    >
                        <DropdownMenuLabel className="p-0 font-normal">
                            <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                                <Avatar className="h-8 w-8 rounded-lg grayscale">
                                    <AvatarFallback>{user.firstName?.substring(0,2).toUpperCase()}</AvatarFallback>
                                </Avatar>
                                <div className="grid flex-1 text-left text-sm leading-tight">
                                    <span className="truncate font-medium">{displayName}</span>
                                    <span className="truncate text-xs">{user.email}</span>
                                </div>
                            </div>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator/>
                        <DropdownMenuGroup>
                            <DropdownMenuItem>
                                <AnimatedThemeToggler text="Toggle Theme"
                                                      className="flex flex-direction-row gap-2 items-center"/>
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                                <HugeiconsIcon icon={SparklesIcon} strokeWidth={2}/>
                                Upgrade to Pro
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator/>
                        <DropdownMenuGroup>
                            <DropdownMenuItem>
                                <HugeiconsIcon icon={CheckmarkBadgeIcon} strokeWidth={2}/>
                                Account
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                                <HugeiconsIcon icon={CreditCardIcon} strokeWidth={2}/>
                                Billing
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                                <HugeiconsIcon icon={NotificationIcon} strokeWidth={2}/>
                                Notifications
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator/>
                        <DropdownMenuItem>
                            <HugeiconsIcon icon={LogoutIcon} strokeWidth={2}/>
                            Log out
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </SidebarMenuItem>
        </SidebarMenu>
    )
}
