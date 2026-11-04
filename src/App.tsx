import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { AppShell } from './components/layout/AppShell';
import { Overview } from './pages/Overview';
import { FixCode } from './pages/FixCode';
import { VerifyAnswer } from './pages/VerifyAnswer';
import { Runs } from './pages/Runs';
import { Settings } from './pages/Settings';

function MainRouter() {
  const { activePage } = useApp();

  switch (activePage) {
    case 'overview':
      return <Overview />;
    case 'fix_code':
      return <FixCode />;
    case 'verify_answer':
      return <VerifyAnswer />;
    case 'runs':
      return <Runs />;
    case 'settings':
      return <Settings />;
    default:
      return <Overview />;
  }
}

export default function App() {
  return (
    <AppProvider>
      <AppShell>
        <MainRouter />
      </AppShell>
    </AppProvider>
  );
}
