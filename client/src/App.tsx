import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import DashboardLayout from "./components/DashboardLayout";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import JobHistory from "./pages/JobHistory";
import NotFound from "./pages/NotFound";
import OwnerTools from "./pages/OwnerTools";
import ResumeProfile from "./pages/ResumeProfile";
import SearchSettings from "./pages/SearchSettings";
import ShortlistMap from "./pages/ShortlistMap";

function Router() {
  return (
    <DashboardLayout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/history" component={JobHistory} />
        <Route path="/settings" component={SearchSettings} />
        <Route path="/profile" component={ResumeProfile} />
        <Route path="/map" component={ShortlistMap} />
        <Route path="/owner-tools" component={OwnerTools} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
