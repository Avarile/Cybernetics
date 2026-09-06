"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ForgotPane } from "./forgot-pane"
import { RegisterPane } from "./register-pane"
import { SignInPane } from "./sign-in-pane"

const REGISTER_ENABLED = process.env.NEXT_PUBLIC_ENABLE_REGISTER === "true"

export function AuthWindow() {
  const [pane, setPane] = useState<"tabs" | "forgot">("tabs")

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col items-center gap-1 text-center">
        <div aria-hidden className="text-2xl">
          ◆
        </div>
        <h1 className="text-sm font-semibold tracking-widest">CYBERNETICS</h1>
      </div>

      {pane === "forgot" ? (
        <ForgotPane onBack={() => setPane("tabs")} />
      ) : REGISTER_ENABLED ? (
        <Tabs defaultValue="signin">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signin">Sign in</TabsTrigger>
            <TabsTrigger value="register">Register</TabsTrigger>
          </TabsList>
          <TabsContent value="signin" className="pt-4">
            <SignInPane onForgot={() => setPane("forgot")} />
          </TabsContent>
          <TabsContent value="register" className="pt-4">
            <RegisterPane />
          </TabsContent>
        </Tabs>
      ) : (
        <>
          <SignInPane onForgot={() => setPane("forgot")} />
          {/* An honest dead end, rather than a Register button that 500s. */}
          <p className="text-center text-xs text-muted-foreground">
            Accounts are provisioned by an administrator.
          </p>
        </>
      )}
    </div>
  )
}
