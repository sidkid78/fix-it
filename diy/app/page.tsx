import { ListenFixAssistant } from '@/components/ListenFixAssistant';

export const metadata = {
  title: 'Listen & Fix - DIY Repair Assistant',
  description: 'Record the problem, get a custom repair guide. AI-powered diagnosis for vehicles, appliances, and more.',
};

export default function Home() {
  return (
    <main className="min-h-screen bg-background bg-cyber-gradient">
      <ListenFixAssistant />

      {/* Footer */}
      <footer className="mt-12 py-8 text-center text-muted-foreground text-sm">
        <p>Powered by Google Gemini AI</p>
        <p className="mt-1">
          Always prioritize safety. When in doubt, consult a professional.
        </p>
      </footer>
    </main>
  );
}