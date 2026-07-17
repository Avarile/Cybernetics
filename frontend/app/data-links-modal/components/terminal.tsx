"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Ansi from "ansi-to-react";
import { CheckIcon, CopyIcon, TerminalIcon, Trash2Icon } from "lucide-react";
import type { ComponentProps, HTMLAttributes } from "react";
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";

interface TerminalContextType {
    output: string;
    isStreaming: boolean;
    autoScroll: boolean;
    onClear?: () => void;
}

const TerminalContext = createContext<TerminalContextType>({
    autoScroll: true,
    isStreaming: false,
    output: "",
});

export type TerminalHeaderProps = HTMLAttributes<HTMLDivElement>;

export const TerminalHeader = ({
                                   className,
                                   children,
                                   ...props
                               }: TerminalHeaderProps) => (
    <div
        className={cn(
            "flex items-center justify-between border-zinc-800 border-b px-4 py-2",
            className
        )}
        {...props}
    >
        {children}
    </div>
);

export type TerminalTitleProps = HTMLAttributes<HTMLDivElement>;

export const TerminalTitle = ({
                                  className,
                                  children,
                                  ...props
                              }: TerminalTitleProps) => (
    <div
        className={cn("flex items-center gap-2 text-sm text-zinc-400", className)}
        {...props}
    >
        <TerminalIcon className="size-4" />
        {children ?? "Terminal"}
    </div>
);

export type TerminalStatusProps = HTMLAttributes<HTMLDivElement>;

export const TerminalStatus = ({
                                   className,
                                   children,
                                   ...props
                               }: TerminalStatusProps) => {
    const { isStreaming } = useContext(TerminalContext);

    if (!isStreaming) {
        return null;
    }

    return (
        <div
            className={cn("flex items-center gap-2 text-xs text-zinc-400", className)}
            {...props}
        >
            {children}
        </div>
    );
};

export type TerminalActionsProps = HTMLAttributes<HTMLDivElement>;

export const TerminalActions = ({
                                    className,
                                    children,
                                    ...props
                                }: TerminalActionsProps) => (
    <div className={cn("flex items-center gap-1", className)} {...props}>
        {children}
    </div>
);

export type TerminalCopyButtonProps = ComponentProps<typeof Button> & {
    onCopy?: () => void;
    onError?: (error: Error) => void;
    timeout?: number;
};

export const TerminalCopyButton = ({
                                       onCopy,
                                       onError,
                                       timeout = 2000,
                                       children,
                                       className,
                                       ...props
                                   }: TerminalCopyButtonProps) => {
    const [isCopied, setIsCopied] = useState(false);
    const timeoutRef = useRef<number>(0);
    const { output } = useContext(TerminalContext);

    const copyToClipboard = useCallback(async () => {
        if (typeof window === "undefined" || !navigator?.clipboard?.writeText) {
            onError?.(new Error("Clipboard API not available"));
            return;
        }

        try {
            await navigator.clipboard.writeText(output);
            setIsCopied(true);
            onCopy?.();
            timeoutRef.current = window.setTimeout(() => setIsCopied(false), timeout);
        } catch (error) {
            onError?.(error as Error);
        }
    }, [output, onCopy, onError, timeout]);

    useEffect(
        () => () => {
            window.clearTimeout(timeoutRef.current);
        },
        []
    );

    const Icon = isCopied ? CheckIcon : CopyIcon;

    return (
        <Button
            className={cn(
                "size-7 shrink-0 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
                className
            )}
            onClick={copyToClipboard}
            size="icon"
            variant="ghost"
            {...props}
        >
            {children ?? <Icon size={14} />}
        </Button>
    );
};

export type TerminalClearButtonProps = ComponentProps<typeof Button>;

export const TerminalClearButton = ({
                                        children,
                                        className,
                                        ...props
                                    }: TerminalClearButtonProps) => {
    const { onClear } = useContext(TerminalContext);

    if (!onClear) {
        return null;
    }

    return (
        <Button
            className={cn(
                "size-7 shrink-0 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
                className
            )}
            onClick={onClear}
            size="icon"
            variant="ghost"
            {...props}
        >
            {children ?? <Trash2Icon size={14} />}
        </Button>
    );
};

export type TerminalContentProps = HTMLAttributes<HTMLDivElement>;

export const TerminalContent = ({
                                    className,
                                    children,
                                    ...props
                                }: TerminalContentProps) => {
    const { output, isStreaming, autoScroll } = useContext(TerminalContext);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (autoScroll && containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [output, autoScroll]);

    return (
        <div
            className={cn(
                "max-h-96 overflow-auto p-4 font-mono text-sm leading-relaxed",
                className
            )}
            ref={containerRef}
            {...props}
        >
            {children ?? (
                <pre className="whitespace-pre-wrap break-words">
          <Ansi>{output}</Ansi>
                    {isStreaming && (
                        <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-zinc-100" />
                    )}
        </pre>
            )}
        </div>
    );
};

export type TerminalProps = HTMLAttributes<HTMLDivElement> & {
    output: string;
    isStreaming?: boolean;
    autoScroll?: boolean;
    onClear?: () => void;
};

export const Terminal = ({
                             output,
                             isStreaming = false,
                             autoScroll = true,
                             onClear,
                             className,
                             children,
                             ...props
                         }: TerminalProps) => {
    const contextValue = useMemo(
        () => ({ autoScroll, isStreaming, onClear, output }),
        [autoScroll, isStreaming, onClear, output]
    );

    return (
        <TerminalContext.Provider value={contextValue}>
            <div
                className={cn(
                    "flex flex-col overflow-hidden rounded-lg border bg-zinc-950 text-zinc-100",
                    className
                )}
                {...props}
            >
                {children ?? (
                    <>
                        {/*<TerminalHeader>*/}
                        {/*  <TerminalTitle />*/}
                        {/*  <div className="flex items-center gap-1">*/}
                        {/*    <TerminalStatus />*/}
                        {/*    <TerminalActions>*/}
                        {/*      <TerminalCopyButton />*/}
                        {/*      {onClear && <TerminalClearButton />}*/}
                        {/*    </TerminalActions>*/}
                        {/*  </div>*/}
                        {/*</TerminalHeader>*/}
                        <TerminalContent />
                    </>
                )}
            </div>
        </TerminalContext.Provider>
    );
};


import { useMockState } from '@/app/data-links-modal/mock-state-control';
import type { Task, TaskStatus } from '@/app/data-links-modal/mock-state-control';

// ── Task Terminal ────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<TaskStatus, { label: string; cls: string }> = {
    pending:   { label: "pending",   cls: "text-zinc-500" },
    started:   { label: "started",   cls: "text-blue-400 animate-pulse" },
    operating: { label: "operating", cls: "text-yellow-400" },
    done:      { label: "done",      cls: "text-emerald-400" },
};

const STATUS_ICON: Record<TaskStatus, string> = {
    pending:   "○",
    started:   "◉",
    operating: "⚡",
    done:      "✓",
};

// Pure render — all state comes from MockStateContext
const TerminalModule = () => {
    const { tasks, logs, activeTask, countdown, nextPending } = useMockState();
    const logsRef = useRef<HTMLDivElement>(null);

    // Auto-scroll log pane whenever logs grow
    useEffect(() => {
        if (logsRef.current) {
            logsRef.current.scrollTop = logsRef.current.scrollHeight;
        }
    }, [logs]);

    const logOutput = logs.join("\n");

    // Compute countdown bar width
    const countdownBarWidth = (() => {
        if (countdown === null || !nextPending) return 0;
        const prevTask = tasks.find(t => t.id === nextPending.id - 1);
        const gapStart = prevTask ? prevTask.startOffset + 5 : 0;
        const gap      = nextPending.startOffset - gapStart;
        if (gap <= 0) return 100;
        return Math.max(0, 100 - (countdown / gap) * 100);
    })();

    return (
        <div className="flex flex-col gap-0 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-100 text-xs font-mono opacity-70">
            {/* ── Task Queue ─────────────────────────────────────── */}
            <div className="border-b border-zinc-800 px-4 py-3">
                <div className="mb-2 flex items-center gap-2 text-zinc-400 text-[11px]">
                    <TerminalIcon className="size-3" />
                    <span>Task Queue</span>
                    {activeTask && (
                        <span className="ml-auto text-yellow-400 animate-pulse">● running</span>
                    )}
                </div>

                <table className="w-full border-collapse">
                    <thead>
                        <tr className="text-zinc-600 text-[10px] uppercase tracking-wider">
                            <th className="pb-1 text-left w-6">#</th>
                            <th className="pb-1 text-left">Task</th>
                            <th className="pb-1 text-right pr-4">Scheduled</th>
                            <th className="pb-1 text-right">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {tasks.map((task: Task) => {
                            const badge    = STATUS_BADGE[task.status];
                            const icon     = STATUS_ICON[task.status];
                            const isActive = task.status === "started" || task.status === "operating";
                            return (
                                <tr
                                    key={task.id}
                                    className={cn(
                                        "transition-colors",
                                        isActive          ? "bg-zinc-800/60" :
                                        task.status === "done" ? "opacity-50"    : ""
                                    )}
                                >
                                    <td className="py-0.5 text-zinc-600">{task.id}</td>
                                    <td className={cn("py-0.5", isActive ? "text-zinc-100" : "text-zinc-400")}>
                                        {isActive && <span className="mr-1 text-yellow-400">›</span>}
                                        {task.name}
                                    </td>
                                    <td className="py-0.5 text-right pr-4 text-zinc-500">
                                        {task.scheduledLabel}
                                    </td>
                                    <td className={cn("py-0.5 text-right tabular-nums", badge.cls)}>
                                        {icon} {badge.label}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* ── Countdown ──────────────────────────────────────── */}
            <div className="border-b border-zinc-800 px-4 py-2 flex items-center gap-2 text-[10px]">
                {countdown !== null ? (
                    <>
                        <span className="text-zinc-500">Next task in</span>
                        <span className="text-blue-400 tabular-nums font-bold">{countdown}s</span>
                        <div className="ml-2 h-1 flex-1 rounded bg-zinc-800 overflow-hidden">
                            <div
                                className="h-full bg-blue-500 transition-all duration-1000"
                                style={{ width: `${countdownBarWidth}%` }}
                            />
                        </div>
                    </>
                ) : (
                    <span className="text-emerald-400">✓ All tasks complete — restarting...</span>
                )}
            </div>

            {/* ── Live Log Output ────────────────────────────────── */}
            <div ref={logsRef} className="h-28 overflow-auto p-3 leading-relaxed">
                {logs.length === 0 ? (
                    <span className="text-zinc-600">Waiting for first task...</span>
                ) : (
                    <pre className="whitespace-pre-wrap break-words">
                        <Ansi>{logOutput}</Ansi>
                        {activeTask && (
                            <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-zinc-100" />
                        )}
                    </pre>
                )}
            </div>
        </div>
    );
};

export default TerminalModule;