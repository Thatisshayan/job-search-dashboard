import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/useMobile";
import { FileUser, History, PanelLeft, SearchCheck, Settings2 } from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";

const menuItems = [
  { icon: SearchCheck, label: "Today’s Shortlist", path: "/" },
  { icon: History, label: "Job History", path: "/history" },
  { icon: Settings2, label: "Search Settings", path: "/settings" },
  { icon: FileUser, label: "Resume Profile", path: "/profile" },
];

const SIDEBAR_WIDTH_KEY = "job-dashboard-sidebar-width";
const DEFAULT_WIDTH = 276;
const MIN_WIDTH = 224;
const MAX_WIDTH = 400;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarWidth, setSidebarWidth] = useState(() => Number(localStorage.getItem(SIDEBAR_WIDTH_KEY)) || DEFAULT_WIDTH);

  useEffect(() => localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth)), [sidebarWidth]);

  return (
    <SidebarProvider style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>{children}</DashboardLayoutContent>
    </SidebarProvider>
  );
}

function DashboardLayoutContent({ children, setSidebarWidth }: { children: React.ReactNode; setSidebarWidth: (width: number) => void }) {
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const isCollapsed = state === "collapsed";
  const activeMenuItem = menuItems.find(item => item.path === location);

  useEffect(() => {
    const move = (event: MouseEvent) => {
      if (!isResizing) return;
      const left = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const width = event.clientX - left;
      if (width >= MIN_WIDTH && width <= MAX_WIDTH) setSidebarWidth(width);
    };
    const stop = () => setIsResizing(false);
    if (isResizing) {
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", stop);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", stop);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar collapsible="icon" className="border-r-0" disableTransition={isResizing}>
          <SidebarHeader className="h-24 justify-center px-3">
            <div className="flex items-center gap-3">
              <button onClick={toggleSidebar} aria-label="Toggle navigation" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"><PanelLeft className="h-4 w-4" /></button>
              {!isCollapsed && <div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sidebar-primary">Daily pursuit</p><p className="mt-1 truncate text-base font-bold text-sidebar-foreground">Construction roles</p></div>}
            </div>
          </SidebarHeader>
          <SidebarContent className="gap-0 px-2">
            <SidebarMenu className="gap-1">
              {menuItems.map(item => (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton isActive={location === item.path} onClick={() => setLocation(item.path)} tooltip={item.label} className="h-11 rounded-xl px-3 font-medium text-sidebar-foreground/75 transition-all hover:text-sidebar-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground">
                    <item.icon className="h-4.5 w-4.5" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarContent>
          <SidebarFooter className="p-3">
            <div className="flex w-full items-center gap-3 rounded-xl p-2 group-data-[collapsible=icon]:justify-center">
              <Avatar className="h-9 w-9 shrink-0 border border-sidebar-border"><AvatarFallback className="bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground">SS</AvatarFallback></Avatar>
              <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden"><p className="truncate text-sm font-semibold text-sidebar-foreground">Shayan Salimi</p><p className="mt-0.5 truncate text-xs text-sidebar-foreground/55">Public dashboard</p></div>
            </div>
          </SidebarFooter>
        </Sidebar>
        {!isCollapsed && <div className="absolute right-0 top-0 z-50 h-full w-1 cursor-col-resize transition-colors hover:bg-sidebar-primary/50" onMouseDown={() => setIsResizing(true)} />}
      </div>
      <SidebarInset>
        {isMobile && <div className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur"><SidebarTrigger className="h-10 w-10 rounded-xl" /><div><p className="text-sm font-bold">{activeMenuItem?.label ?? "Construction roles"}</p><p className="text-xs text-muted-foreground">Shayan’s private workspace</p></div></div>}
        <main className="min-h-dvh flex-1 p-4 md:p-7">{children}</main>
      </SidebarInset>
    </>
  );
}
