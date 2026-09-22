import { ActivityIndicator, Platform, Pressable, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import DashboardScreen from '../screens/DashboardScreen';
import TimelineScreen from '../screens/TimelineScreen';
import UploadScreen from '../screens/UploadScreen';
import ReportDetailScreen from '../screens/ReportDetailScreen';
import ParameterTrendScreen from '../screens/ParameterTrendScreen';
import OrganDetailScreen from '../screens/OrganDetailScreen';
import InsightsScreen from '../screens/InsightsScreen';
import NeedsAttentionScreen from '../screens/NeedsAttentionScreen';
import ChatScreen from '../screens/ChatScreen';
import MedicationsScreen from '../screens/MedicationsScreen';
import MedicationDetailScreen from '../screens/MedicationDetailScreen';
import MedicationScanReviewScreen from '../screens/MedicationScanReviewScreen';
import MedicationCreateScreen from '../screens/MedicationCreateScreen';
import ActivityScreen from '../screens/ActivityScreen';
import DietScreen from '../screens/DietScreen';
import DietScanReviewScreen from '../screens/DietScanReviewScreen';
import DietEntryFormScreen from '../screens/DietEntryFormScreen';
import DietStatsScreen from '../screens/DietStatsScreen';
import DietRecipeScreen from '../screens/DietRecipeScreen';
import SettingsScreen from '../screens/SettingsScreen';
import RecipePreferencesScreen from '../screens/RecipePreferencesScreen';
import GmailIntegrationScreen from '../screens/GmailIntegrationScreen';
import LoginScreen from '../screens/LoginScreen';
import LanguagePreferenceScreen from '../screens/LanguagePreferenceScreen';
import VoiceAccessibilityScreen from '../screens/VoiceAccessibilityScreen';
import { useAuth } from '../auth/AuthContext';
import { useT } from '../i18n/I18nContext';
import { colors } from '../theme/theme';

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.surface,
    text: colors.textPrimary,
    border: colors.border,
    primary: colors.primary,
  },
};

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// Explicit path mapping rather than relying on React Navigation's implicit
// web linking inference — on web, tab-bar links otherwise render correct
// hrefs but don't reliably wire up click-to-navigate.
const linking = {
  prefixes: [],
  config: {
    screens: {
      Tabs: {
        screens: {
          DashboardTab: '',
          TimelineTab: 'timeline',
          ChatTab: 'ask',
          UploadTab: 'upload',
          MedicationsTab: 'medications',
        },
      },
      ReportDetail: 'report/:reportId',
      ParameterTrend: 'trend/:code',
      OrganDetail: 'organ/:organKey',
      Insights: 'insights',
      NeedsAttention: 'needs-attention',
      MedicationDetail: 'medications/:medicationId',
      MedicationScanReview: 'medications/scans/:scanId',
      Activity: 'activity',
      Diet: 'diet',
      DietScanReview: 'diet/scans/:scanId',
      DietEntryForm: 'diet/entries/:entryId?',
      DietStats: 'diet/stats',
      DietRecipe: 'diet/recipe',
      Settings: 'settings',
      RecipePreferences: 'settings/recipe-preferences',
      GmailIntegration: 'settings/gmail',
      LanguagePreference: 'settings/language',
      VoiceAccessibility: 'settings/voice',
    },
  },
};

function Tabs() {
  const t = useT();
  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.textPrimary,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textTertiary,
        // react-native-web's Pressable renders the `href` React Navigation
        // hands it as a real <a href>, so an unmodified click triggers the
        // browser's own full-page navigation before/alongside React
        // Navigation's onPress-driven client-side route change - reloading
        // the whole app (remounting AuthContext, losing all state) on every
        // tab tap. Prevent that default so onPress is the only thing that
        // runs, while still letting cmd/ctrl/shift/middle-click open the
        // tab in a new browser tab as a plain link would.
        tabBarButton: (props) => (
          <Pressable
            {...props}
            onPress={(event) => {
              if (
                Platform.OS === 'web' &&
                !(event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1)
              ) {
                event.preventDefault();
              }
              props.onPress?.(event);
            }}
          />
        ),
      }}
    >
      <Tab.Screen name="DashboardTab" component={DashboardScreen} options={{ title: t('nav.dashboard'), headerShown: false }} />
      <Tab.Screen name="TimelineTab" component={TimelineScreen} options={{ title: t('nav.timeline'), headerShown: false }} />
      <Tab.Screen
        name="MedicationsTab"
        component={MedicationsScreen}
        options={{ title: t('nav.medications'), headerShown: false }}
      />
      <Tab.Screen name="ChatTab" component={ChatScreen} options={{ title: t('nav.ask'), headerShown: false }} />
      <Tab.Screen name="UploadTab" component={UploadScreen} options={{ title: t('nav.upload'), headerShown: false }} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { user, loading } = useAuth();
  const t = useT();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <NavigationContainer theme={navigationTheme} linking={linking}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
        <Stack.Screen name="ReportDetail" component={ReportDetailScreen} options={{ title: t('nav.report') }} />
        <Stack.Screen name="ParameterTrend" component={ParameterTrendScreen} options={{ title: t('nav.trend') }} />
        <Stack.Screen name="OrganDetail" component={OrganDetailScreen} options={{ title: t('nav.organHealth') }} />
        <Stack.Screen name="Insights" component={InsightsScreen} options={{ title: t('nav.insights') }} />
        <Stack.Screen name="NeedsAttention" component={NeedsAttentionScreen} options={{ title: t('nav.needsAttention') }} />
        <Stack.Screen name="MedicationDetail" component={MedicationDetailScreen} options={{ title: t('nav.medication') }} />
        <Stack.Screen
          name="MedicationScanReview"
          component={MedicationScanReviewScreen}
          options={{ title: t('nav.reviewScan') }}
        />
        <Stack.Screen
          name="MedicationCreate"
          component={MedicationCreateScreen}
          options={{ title: t('nav.addMedication') }}
        />
        <Stack.Screen name="Activity" component={ActivityScreen} options={{ title: t('nav.activity') }} />
        <Stack.Screen name="Diet" component={DietScreen} options={{ title: t('nav.diet') }} />
        <Stack.Screen name="DietScanReview" component={DietScanReviewScreen} options={{ title: t('nav.reviewScan') }} />
        <Stack.Screen
          name="DietEntryForm"
          component={DietEntryFormScreen}
          options={({ route }) => ({ title: route.params?.entryId ? t('nav.editItem') : t('nav.addItem') })}
        />
        <Stack.Screen name="DietStats" component={DietStatsScreen} options={{ title: t('nav.dietStats') }} />
        <Stack.Screen name="DietRecipe" component={DietRecipeScreen} options={{ title: t('nav.recipeIdeas') }} />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: t('nav.settings') }} />
        <Stack.Screen
          name="RecipePreferences"
          component={RecipePreferencesScreen}
          options={{ title: t('nav.recipePreferences') }}
        />
        <Stack.Screen
          name="GmailIntegration"
          component={GmailIntegrationScreen}
          options={{ title: t('nav.connectedSources') }}
        />
        <Stack.Screen
          name="LanguagePreference"
          component={LanguagePreferenceScreen}
          options={{ title: t('nav.language') }}
        />
        <Stack.Screen
          name="VoiceAccessibility"
          component={VoiceAccessibilityScreen}
          options={{ title: t('nav.voiceAccessibility') }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
