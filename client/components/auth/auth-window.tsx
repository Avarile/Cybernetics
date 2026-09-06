"use client"

import { useState } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ForgotPane } from "./forgot-pane"
import { RegisterPane } from "./register-pane"
import { SignInPane } from "./sign-in-pane"

const REGISTER_ENABLED = process.env.NEXT_PUBLIC_ENABLE_REGISTER === "true"

/**
 * The card is the whole dialog: WindowLayer renders this kind chromeless and
 * centres it, so there is no frame, no title bar and no close button around it.
 */
const HEADINGS = {
  signin: {
    title: "Sign in to your account",
    description: "Enter your email below to sign in to your account",
  },
  forgot: {
    title: "Reset your password",
    description: "We'll send a reset code to this address",
  },
  tabs: {
    title: "Access",
    description: "Sign in, or create an account",
  },
} as const

export function AuthWindow() {
  const [pane, setPane] = useState<"tabs" | "forgot">("tabs")

  const heading =
    pane === "forgot" ? HEADINGS.forgot : REGISTER_ENABLED ? HEADINGS.tabs : HEADINGS.signin

  return (
    <Card>
      <CardHeader className="justify-items-center text-center">
        <div aria-hidden className="text-2xl">
          ◆
        </div>
        <h1 className="text-sm font-semibold tracking-widest">CYBERNETICS</h1>
        <CardTitle>{heading.title}</CardTitle>
        <CardDescription>{heading.description}</CardDescription>
      </CardHeader>

      <CardContent>
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
            <p className="text-center text-sm text-muted-foreground">
              Accounts are provisioned by an administrator.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
