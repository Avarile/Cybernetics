import {HugeiconsIcon} from "@hugeicons/react"
import {
    BookOpen02Icon,
    ChartUpIcon,
    CropIcon,
    CustomerService01Icon,
    Folder01Icon,
    MapsIcon,
    PieChartIcon,
    SearchIcon,
    Settings05Icon,
} from "@hugeicons/core-free-icons"

export const route = {
    dataLink: {
        title: "Data Link",
        url: "/data-links",
    },
    navMain: [
        {
            title: "Statistics",
            url: "/dashboard/statistics",
            icon: (
                <HugeiconsIcon icon={ChartUpIcon} strokeWidth={2}/>
            ),
            isActive: true,
            items: [
                {
                    title: "Overview",
                    url: "/dashboard/statistics",
                },
                {
                    title: "Projects",
                    url: "/dashboard/projects",
                },
                {
                    title: "Tasks",
                    url: "/dashboard/tasks",
                },
                {
                    title: "Knowledges",
                    url: "/dashboard/knowledge",
                },
            ],
        },
        {
            title: "Execution",
            url: "#",
            icon: (
                <HugeiconsIcon icon={Folder01Icon} strokeWidth={2}/>
            ),
            isActive: true,
            items: [
                {
                    title: "Plans",
                    url: "/dashboard/plans",
                },
                {
                    title: "Daily",
                    url: "/dashboard/daily-summary",
                },
                {
                    title: "Scheduler",
                    url: "/dashboard/scheduler",
                },
            ],
        },
        {
            title: "Communication",
            url: "#",
            icon: (
                <HugeiconsIcon icon={BookOpen02Icon} strokeWidth={2}/>
            ),
            isActive: true,
            items: [
                {
                    title: "Contacts",
                    url: "/dashboard/contacts",
                },
                {
                    title: "Companies",
                    url: "/dashboard/companies",
                },
                {
                    title: "Calls",
                    url: "/dashboard/calls",
                },
                {
                    title: "Emails",
                    url: "/dashboard/emails",
                },
            ],
        },
    ],
    navSecondary: [
        {
            title: "Settings",
            url: "#",
            icon: (
                <HugeiconsIcon icon={Settings05Icon} strokeWidth={2}/>
            ),
            isActive: true,
        },
        {
            title: "Get Help",
            url: "#",
            icon: (
                <HugeiconsIcon icon={CustomerService01Icon} strokeWidth={2}/>
            ),
        },
        {
            title: "Search",
            url: "#",
            icon: (
                <HugeiconsIcon icon={SearchIcon} strokeWidth={2}/>
            ),
        },
    ],
    projects: [
        {
            name: "Examples",
            url: "/dashboard/example",
            icon: (
                <HugeiconsIcon icon={CropIcon} strokeWidth={2}/>
            ),
        },
        {
            name: "Canvas",
            url: "/dashboard/canvas",
            icon: (
                <HugeiconsIcon icon={PieChartIcon} strokeWidth={2}/>
            ),
        },
        {
            name: "Travel",
            url: "#",
            icon: (
                <HugeiconsIcon icon={MapsIcon} strokeWidth={2}/>
            ),
        },
    ],
}
