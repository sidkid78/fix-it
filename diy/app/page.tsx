import { ListenFixAssistant } from '@/components/ListenFixAssistant';

export const metadata = {
  title: 'Listen & Fix - DIY Repair Assistant',
  description: 'Record the problem, get a custom repair guide. AI-powered diagnosis for vehicles, appliances, and more.',
};

export default function Home() {
  return (
    <main className="min-h-screen bg-linear-to-b from-gray-50 to-gray-100">
      <ListenFixAssistant />

      {/* Footer */}
      <footer className="mt-12 py-8 text-center text-gray-500 text-sm">
        <p>Powered by Google Gemini AI</p>
        <p className="mt-1">
          Always prioritize safety. When in doubt, consult a professional.
        </p>
      </footer>
    </main>
  );
}