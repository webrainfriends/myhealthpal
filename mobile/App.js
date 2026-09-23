import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import RootNavigator from './src/navigation/RootNavigator';
import { AuthProvider } from './src/auth/AuthContext';
import { I18nProvider } from './src/i18n/I18nContext';
import { VoiceProvider } from './src/voice/VoiceContext';
import ErrorBoundary from './src/components/ErrorBoundary';

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <I18nProvider>
          <VoiceProvider>
            <StatusBar style="dark" />
            <ErrorBoundary>
              <RootNavigator />
            </ErrorBoundary>
          </VoiceProvider>
        </I18nProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
