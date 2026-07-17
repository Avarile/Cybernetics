'use client'

import { useState } from "react"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import Link from "next/link"
import {
    NavigationMenu,
    NavigationMenuContent,
    NavigationMenuItem,
    NavigationMenuLink,
    NavigationMenuList,
    NavigationMenuTrigger,
    navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu"
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet"
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion"
import { NotificationDrawer } from "@/components/notification-drawer"
import { ForceModal } from "@/components/force-modal"
import { IconHierarchy, IconMenu2 } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"

const gettingStartedItems: { href: string; title: string; description: string }[] = [
    {
        href: "/docs",
        title: "Introduction",
        description: "Re-usable components built with Tailwind CSS.",
    },
    {
        href: "/docs/installation",
        title: "Installation",
        description: "How to install dependencies and structure your app.",
    },
    {
        href: "/docs/primitives/typography",
        title: "Typography",
        description: "Styles for headings, paragraphs, lists...etc",
    },
]

const components: { title: string; href: string; description: string }[] = [
    {
        title: "Alert Dialog",
        href: "/docs/primitives/alert-dialog",
        description: "A modal dialog that interrupts the user with important content and expects a response.",
    },
    {
        title: "Hover Card",
        href: "/docs/primitives/hover-card",
        description: "For sighted users to preview content available behind a link.",
    },
    {
        title: "Progress",
        href: "/docs/primitives/progress",
        description: "Displays an indicator showing the completion progress of a task, typically displayed as a progress bar.",
    },
    {
        title: "Scroll-area",
        href: "/docs/primitives/scroll-area",
        description: "Visually or semantically separates content.",
    },
    {
        title: "Tabs",
        href: "/docs/primitives/tabs",
        description: "A set of layered sections of content—known as tab panels—that are displayed one at a time.",
    },
    {
        title: "Tooltip",
        href: "/docs/primitives/tooltip",
        description: "A popup that displays information related to an element when the element receives keyboard focus or the mouse hovers over it.",
    },
]

function ListItem({
    title,
    children,
    href,
    ...props
}: React.ComponentPropsWithoutRef<"li"> & { href: string }) {
    return (
        <li {...props}>
            <NavigationMenuLink asChild>
                <Link href={href}>
                    <div className="flex flex-col gap-1 p-3 text-sm rounded-md hover:bg-accent transition-colors">
                        <div className="leading-none font-medium">{title}</div>
                        <div className="line-clamp-2 text-muted-foreground">{children}</div>
                    </div>
                </Link>
            </NavigationMenuLink>
        </li>
    )
}

export function SiteHeader() {
    const [mobileOpen, setMobileOpen] = useState(false)
    const [forceModalOpen, setForceModalOpen] = useState(false)

    return (
        <header className="sticky top-0 z-50 flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-background transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
            <div className="flex w-full items-center gap-2 px-4">
                <SidebarTrigger className="-ml-1" />
                <Separator
                    orientation="vertical"
                    className="mr-2 data-vertical:h-4 data-vertical:self-auto"
                />

                {/* Desktop navigation — md and above */}
                <div className="hidden md:flex">
                    <NavigationMenu>
                        <NavigationMenuList>
                            <NavigationMenuItem>
                                <NavigationMenuTrigger>Getting started</NavigationMenuTrigger>
                                <NavigationMenuContent>
                                    <ul className="w-80 lg:w-96">
                                        {gettingStartedItems.map((item) => (
                                            <ListItem key={item.title} href={item.href} title={item.title}>
                                                {item.description}
                                            </ListItem>
                                        ))}
                                    </ul>
                                </NavigationMenuContent>
                            </NavigationMenuItem>
                            <NavigationMenuItem>
                                <NavigationMenuTrigger>Components</NavigationMenuTrigger>
                                <NavigationMenuContent>
                                    <ul className="grid w-[420px] gap-1 md:grid-cols-2 lg:w-[540px]">
                                        {components.map((component) => (
                                            <ListItem
                                                key={component.title}
                                                title={component.title}
                                                href={component.href}
                                            >
                                                {component.description}
                                            </ListItem>
                                        ))}
                                    </ul>
                                </NavigationMenuContent>
                            </NavigationMenuItem>
                            <NavigationMenuItem>
                                <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
                                    <Link href="/docs">Docs</Link>
                                </NavigationMenuLink>
                            </NavigationMenuItem>
                        </NavigationMenuList>
                    </NavigationMenu>
                </div>

                {/* Mobile navigation — below md */}
                <div className="flex md:hidden">
                    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                        <SheetTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8">
                                <IconMenu2 className="h-5 w-5" />
                                <span className="sr-only">Open menu</span>
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="left" className="w-72 p-0 flex flex-col">
                            <SheetHeader className="border-b px-4 py-3">
                                <SheetTitle className="text-left text-sm font-semibold">
                                    Navigation
                                </SheetTitle>
                            </SheetHeader>
                            <div className="flex-1 overflow-y-auto">
                                <Accordion type="multiple" className="w-full">
                                    {/* Getting started group */}
                                    <AccordionItem value="getting-started" className="border-b">
                                        <AccordionTrigger className="px-4 py-3 text-sm font-medium hover:no-underline hover:bg-accent/50">
                                            Getting started
                                        </AccordionTrigger>
                                        <AccordionContent className="pb-0">
                                            <ul className="flex flex-col border-t">
                                                {gettingStartedItems.map((item) => (
                                                    <li key={item.title}>
                                                        <Link
                                                            href={item.href}
                                                            onClick={() => setMobileOpen(false)}
                                                            className="flex flex-col gap-0.5 px-6 py-3 text-sm hover:bg-accent transition-colors"
                                                        >
                                                            <span className="font-medium">{item.title}</span>
                                                            <span className="text-xs text-muted-foreground line-clamp-2">
                                                                {item.description}
                                                            </span>
                                                        </Link>
                                                    </li>
                                                ))}
                                            </ul>
                                        </AccordionContent>
                                    </AccordionItem>

                                    {/* Components group */}
                                    <AccordionItem value="components" className="border-b">
                                        <AccordionTrigger className="px-4 py-3 text-sm font-medium hover:no-underline hover:bg-accent/50">
                                            Components
                                        </AccordionTrigger>
                                        <AccordionContent className="pb-0">
                                            <ul className="flex flex-col border-t">
                                                {components.map((component) => (
                                                    <li key={component.title}>
                                                        <Link
                                                            href={component.href}
                                                            onClick={() => setMobileOpen(false)}
                                                            className="flex flex-col gap-0.5 px-6 py-3 text-sm hover:bg-accent transition-colors"
                                                        >
                                                            <span className="font-medium">{component.title}</span>
                                                            <span className="text-xs text-muted-foreground line-clamp-2">
                                                                {component.description}
                                                            </span>
                                                        </Link>
                                                    </li>
                                                ))}
                                            </ul>
                                        </AccordionContent>
                                    </AccordionItem>
                                </Accordion>

                                {/* Docs — direct link, no accordion */}
                                <Link
                                    href="/docs"
                                    onClick={() => setMobileOpen(false)}
                                    className="flex items-center px-4 py-3 text-sm font-medium hover:bg-accent transition-colors border-b"
                                >
                                    Docs
                                </Link>
                            </div>
                        </SheetContent>
                    </Sheet>
                </div>

                {/* Right-side actions */}
                <div className="ml-auto flex items-center gap-1 pr-2">
                    <NotificationDrawer />
                    <Button
                        size="icon"
                        className="size-8 group-data-[collapsible=icon]:opacity-0"
                        variant="ghost"
                        onClick={() => setForceModalOpen(true)}
                    >
                        <IconHierarchy />
                        <span className="sr-only">Project Graph</span>
                    </Button>
                </div>
            </div>

            <ForceModal open={forceModalOpen} onClose={() => setForceModalOpen(false)} />
        </header>
    )
}
