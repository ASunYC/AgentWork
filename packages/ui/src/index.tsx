import type { PropsWithChildren } from 'react';

export function PageContainer({ children }: PropsWithChildren) {
  return (
    <main style={{ margin: '4rem auto', maxWidth: 960, padding: '0 1.5rem' }}>
      {children}
    </main>
  );
}
