import React, { useState, useEffect, useRef, ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const drawerRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const drawer = drawerRef.current;
    if (mobileMenuOpen) drawer?.showModal();
    else drawer?.close();
  }, [mobileMenuOpen]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => {
      if (desktop.matches) setMobileMenuOpen(false);
    };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);

  return (
    <div className="flex h-dvh w-full bg-[#F8FAF9] overflow-hidden">
      {/* Desktop Sidebar */}
      <div className="hidden lg:block h-full">
        <Sidebar />
      </div>

      {/* Mobile Drawer Backdrop & Sidebar */}
      <dialog
        ref={drawerRef}
        aria-label="Navigation menu"
        onCancel={() => setMobileMenuOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setMobileMenuOpen(false);
        }}
        className="fixed inset-0 m-0 max-w-none max-h-none w-full h-dvh bg-transparent backdrop:bg-slate-900/40 backdrop:backdrop-blur-xs"
      >
        <div className="relative h-full w-[240px]">
          <button
            type="button"
            aria-label="Close navigation menu"
            className="absolute top-4 left-[248px] rounded-lg bg-white px-3 py-2 text-sm shadow-sm"
            onClick={() => setMobileMenuOpen(false)}
          >×</button>
          <Sidebar onCloseMobile={() => setMobileMenuOpen(false)} />
        </div>
      </dialog>

      {/* Main Content Viewport */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <TopBar onOpenMobileMenu={() => setMobileMenuOpen(true)} />
        <main id="app-main" className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
