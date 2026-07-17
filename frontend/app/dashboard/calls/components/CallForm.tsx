"use client"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod/v3"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"

const CALL_STATUSES = ['failed', 'voice_mail', 'completed', 'no_show'] as const
const CALL_OUTCOMES = ['success', 'failure', 'follow_up_required', 'rescheduled', 'no_outcome'] as const

const formSchema = z.object({
  callID: z.string(),
  status: z.enum(['failed', 'voice_mail', 'completed', 'no_show']),
  outcome: z.enum(['success', 'failure', 'follow_up_required', 'rescheduled', 'no_outcome']),
  transcript: z.string(),
  duration: z.string(),
})

export type CallFormValues = z.infer<typeof formSchema>

export interface CallFormProps {
  defaultValues?: Partial<CallFormValues>
  onSubmit: (values: CallFormValues) => Promise<void>
  onCancel: () => void
  isPending?: boolean
}

export function CallForm({ defaultValues, onSubmit, onCancel, isPending }: CallFormProps) {
  const form = useForm<CallFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      callID: '',
      status: 'completed',
      outcome: 'no_outcome',
      transcript: '',
      duration: '',
      ...defaultValues,
    },
  })

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="callID"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Call ID</FormLabel>
              <FormControl>
                <Input placeholder="Optional call identifier" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="status"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Status</FormLabel>
              <FormControl>
                <select
                  {...field}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                >
                  {CALL_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="outcome"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Outcome</FormLabel>
              <FormControl>
                <select
                  {...field}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                >
                  {CALL_OUTCOMES.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="duration"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Duration (seconds)</FormLabel>
              <FormControl>
                <Input type="number" placeholder="e.g. 120" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="transcript"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Transcript</FormLabel>
              <FormControl>
                <Textarea placeholder="Optional transcript" rows={4} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Form>
  )
}
