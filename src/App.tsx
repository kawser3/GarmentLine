import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ConfirmProvider } from "@/components/confirm";
import { BusyProvider } from "@/components/busy";
import { AppLayout } from "@/components/layout";
import { Preloader } from "@/components/preloader";
import {
  CallbackPage,
  LoginPage,
  RequireAuth,
  RequireRole,
  useSessionBootstrap,
} from "@/features/auth/auth-pages";
import { ActivatePage } from "@/features/account/activate-page";
import {
  ChangePasswordPage,
  ForgotPasswordPage,
  ResetPasswordPage,
} from "@/features/account/password-pages";
import { DashboardPage } from "@/pages/dashboard";
import { IssuesPage } from "@/pages/issues";
import { IssueDetailPage } from "@/pages/issue-detail";
import { SamplesPage } from "@/pages/samples";
import { StyleSamplesPage } from "@/pages/style-samples";
import { BuyersPage, LinesPage, MasterDataLayout, StylesPage } from "@/pages/master-data";
import { UsersPage } from "@/pages/users";
import { useI18nOverlay, useI18nStore } from "@/features/i18n/i18n";
import { ROLES } from "@/stores/auth";

/**
 * The management view. The brief gives the GM "everything including cost impact";
 * a merchandiser gets the same aggregates for the buyers they own, which is what
 * makes the view useful before it reaches the GM's desk.
 */
const MANAGEMENT_ROLES = [ROLES.admin, ROLES.gm, ROLES.merchandiser];

/** Master data: buyers, styles, lines. Reshaping the organisation, not reading it. */
const MASTER_ROLES = [ROLES.admin, ROLES.gm, ROLES.merchandiser];

/**
 * People. Admin and the factory manager only.
 *
 * Deliberately NOT the merchandiser: they own the styles and can stamp a sample
 * approved, and still cannot create an account. Authority over the product and
 * authority over access are separate, and this is where that line is drawn.
 */
const PEOPLE_ROLES = [ROLES.admin, ROLES.gm];

export default function App() {
  useSessionBootstrap();
  /*
   * One overlay fetch per load, before any route renders - the login screen speaks the
   * chosen language too. It never blocks: the bundled dictionary paints first and the
   * service strings replace them when they arrive (i18n.tsx).
   */
  useI18nOverlay();
  const locale = useI18nStore((s) => s.locale);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    /* Busy inside Confirm: a bulk action confirms first, then shows progress. */
    <ConfirmProvider>
      <BusyProvider>
        {/* Outside <Routes> so a navigation does not unmount the thing covering it. */}
        <Preloader />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/login/callback" element={<CallbackPage />} />
          {/* Public: an invited user arrives with ?code=<token> and has no session yet. */}
          <Route path="/activate" element={<ActivatePage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          {/* /resetpassword with no hyphen - the URL IAM's own email generates. */}
          <Route path="/resetpassword" element={<ResetPasswordPage />} />

          {/*
            Everything else needs a session. The issue register and the approval history
            are records of who decided what; there is no anonymous surface over them.
          */}
          <Route
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/issues" replace />} />

            <Route path="/issues" element={<IssuesPage />} />
            <Route path="/issues/:id" element={<IssueDetailPage />} />

            {/* Sample versions and the decision of record. A supervisor may look; the
                approve control itself is gated inside the page on canApproveSample. */}
            <Route path="/samples" element={<SamplesPage />} />
            <Route path="/samples/:styleId" element={<StyleSamplesPage />} />

            <Route
              path="/dashboard"
              element={
                <RequireRole any={MANAGEMENT_ROLES}>
                  <DashboardPage />
                </RequireRole>
              }
            />

            <Route
              path="/master"
              element={
                <RequireRole any={MASTER_ROLES}>
                  <MasterDataLayout />
                </RequireRole>
              }
            >
              <Route index element={<Navigate to="/master/buyers" replace />} />
              <Route path="buyers" element={<BuyersPage />} />
              <Route path="styles" element={<StylesPage />} />
              <Route path="lines" element={<LinesPage />} />
            </Route>

            <Route
              path="/people"
              element={
                <RequireRole any={PEOPLE_ROLES}>
                  <UsersPage />
                </RequireRole>
              }
            />

            <Route path="/account/password" element={<ChangePasswordPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/issues" replace />} />
        </Routes>
      </BusyProvider>
    </ConfirmProvider>
  );
}
