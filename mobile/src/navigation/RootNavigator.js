import { ActivityIndicator, Platform, Pressable, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import DashboardScreen from '../screens/DashboardScreen';
import TimelineScreen from '../screens/TimelineScreen';
import UploadScreen from '../screens/UploadScreen';
import ReportDetailScreen from '../screens/ReportDetailScreen';
import ParameterTrendScreen from '../screens/ParameterTrendScreen';
import InsightsScreen from '../screens/InsightsScreen';
import ChatScreen from '../screens/ChatScreen';
import LoginScreen from '../screens/LoginScreen';
import { useAuth } from '../auth/AuthContext';
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
        },
      },
      ReportDetail: 'report/:reportId',
      ParameterTrend: 'trend/:code',
      Insights: 'insights',
    },
  },
};

function Tabs() {
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
      <Tab.Screen name="DashboardTab" component={DashboardScreen} options={{ title: 'Dashboard', headerShown: false }} />
      <Tab.Screen name="TimelineTab" component={TimelineScreen} options={{ title: 'Timeline', headerShown: false }} />
      <Tab.Screen name="ChatTab" component={ChatScreen} options={{ title: 'Ask', headerShown: false }} />
      <Tab.Screen name="UploadTab" component={UploadScreen} options={{ title: 'Upload', headerShown: false }} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { user, loading } = useAuth();

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
        <Stack.Screen name="ReportDetail" component={ReportDetailScreen} options={{ title: 'Report' }} />
        <Stack.Screen name="ParameterTrend" component={ParameterTrendScreen} options={{ title: 'Trend' }} />
        <Stack.Screen name="Insights" component={InsightsScreen} options={{ title: 'AI insights' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
