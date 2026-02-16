import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AppLayout,
  TopNavigation,
  SideNavigation,
  SideNavigationProps,
} from '@cloudscape-design/components';
import { useAuth } from '../contexts/AuthContext';

interface LayoutProps {
  children: ReactNode;
  navigationHide?: boolean;
}

/**
 * Main application layout using Cloudscape components
 */
export function Layout({ children, navigationHide = false }: LayoutProps) {
  const navigate = useNavigate();
  const { logout, user } = useAuth();

  const navigationItems: SideNavigationProps.Item[] = [
    {
      type: 'link',
      text: 'Dashboard',
      href: '/dashboard',
    },
    {
      type: 'link',
      text: 'Upload Meeting',
      href: '/upload',
    },
    {
      type: 'divider',
    },
    {
      type: 'link',
      text: 'Settings',
      href: '/settings',
    },
  ];

  const handleNavigate = (event: CustomEvent<SideNavigationProps.FollowDetail>) => {
    event.preventDefault();
    navigate(event.detail.href);
  };

  return (
    <>
      <TopNavigation
        identity={{
          href: '/',
          title: 'Meeting Analysis Platform',
        }}
        utilities={[
          {
            type: 'menu-dropdown',
            text: user?.email || 'User',
            iconName: 'user-profile',
            items: [
              {
                id: 'logout',
                text: 'Logout',
              },
            ],
            onItemClick: async ({ detail }) => {
              if (detail.id === 'logout') {
                try {
                  await logout();
                } catch (error) {
                  console.error('Failed to logout:', error);
                }
              }
            },
          },
        ]}
      />
      <AppLayout
        navigation={
          navigationHide ? undefined : (
            <SideNavigation
              header={{ text: 'Navigation', href: '/' }}
              items={navigationItems}
              onFollow={handleNavigate}
            />
          )
        }
        content={children}
        toolsHide
        navigationWidth={200}
      />
    </>
  );
}
