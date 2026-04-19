"use client";

// Mobile nav — hamburger trigger + left-side Sheet containing the same
// nav content as the desktop rail.
// WHY: isolates the client-only bits (Sheet state + theme toggle) behind
// a `md:hidden` boundary so the topbar itself can stay a server component.

import { Menu } from "lucide-react";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Sidebar } from "@/components/shell/sidebar";

export function MobileNav({
  portfolioId,
  portfolioName,
}: {
  portfolioId: string;
  portfolioName: string;
}): ReactElement {
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            aria-label="Open navigation"
          >
            <Menu />
          </Button>
        }
      />
      <SheetContent
        side="left"
        showCloseButton={false}
        className="w-[280px] max-w-[280px] p-0 sm:max-w-[280px]"
      >
        {/* WHY: accessible dialog semantics — provide a title/description
            for screen readers, but visually hide them since the sidebar
            already communicates its purpose. */}
        <SheetHeader className="sr-only">
          <SheetTitle>Navigation</SheetTitle>
          <SheetDescription>
            Jump between sections of {portfolioName}.
          </SheetDescription>
        </SheetHeader>
        <Sidebar
          portfolioId={portfolioId}
          portfolioName={portfolioName}
          forceExpanded
        />
      </SheetContent>
    </Sheet>
  );
}
