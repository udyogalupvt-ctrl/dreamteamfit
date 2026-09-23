# Elevate Gym Hub

Build the FOUNDATION of a world-class Gym Management SaaS application.

IMPORTANT:
Do NOT build all business features yet.
For this prompt, focus only on:
1. Application architecture
2. Global UI/UX design system
3. Responsive layout
4. Authentication foundation
5. Firebase connection
6. Cloudinary connection
7. Main application shell/navigation
8. Reusable components and design tokens

This application will eventually become a complete Gym CRM + Membership + Billing + Attendance + Biometric + Follow-up platform.

==================================================
TECHNICAL DIRECTION
==================================================


Use:
- TypeScript
- React
- Modern component architecture
- Tailwind CSS or the platform's equivalent utility styling
- Firebase Authentication
- Firebase Firestore
- Cloudinary for image uploads
- Clean reusable components
- Strong type safety
- Responsive layouts
- Accessible interactions

Do NOT create unnecessary backend complexity.

The application should be structured so future modules can be added cleanly:
- Dashboard
- Inquiries
- Clients
- Packages
- Billing
- Attendance
- Follow-ups
- Reports
- Settings
- Biometric integration
- Automation

==================================================
BRAND / VISUAL DIRECTION
==================================================

The product must feel like a premium modern fitness/gym SaaS.

Visual personality:
- Bold
- Energetic
- Premium
- Athletic
- Modern
- Powerful
- Clean
- High-end SaaS
- Professional enough for a real gym chain

Avoid:
- Generic admin-dashboard appearance
- Old-fashioned ERP styling
- Excessive gradients
- Excessive glassmorphism
- Tiny unreadable text
- Overcrowded layouts
- Weak colors
- Amateur-looking cards
- Excessive shadows

Use energetic gym-inspired accent colors such as:
- Electric lime
- Neon green
- Energetic orange
- Strong blue
- Violet accents

But use them intelligently.

The interface must look professional in both light and dark mode.

==================================================
THEME SYSTEM
==================================================

Implement a complete theme system.

Themes:
1. Light mode
2. Dark mode
3. System preference mode

The user should be able to switch theme instantly.

Persist theme preference.

Dark mode must be intentionally designed.
Do NOT simply invert the light theme.

Light mode:
- Bright
- Clean
- Premium
- Excellent contrast

Dark mode:
- Deep charcoal/graphite surfaces
- Strong contrast
- Energetic accent colors
- Comfortable eye-friendly hierarchy
- No pure-black excessive usage

Make every component theme-aware.

==================================================
TYPOGRAPHY
==================================================

Use a premium modern sans-serif typography system.

Create clear hierarchy for:
- Page titles
- Section titles
- Card titles
- Body text
- Labels
- Metadata
- Buttons
- Numbers/statistics

Large numbers such as revenue, members, collections and statistics should have strong visual emphasis.

Typography must remain readable on mobile.

==================================================
DESIGN SYSTEM
==================================================

Create reusable design tokens for:

- Background
- Surface
- Elevated surface
- Border
- Primary text
- Secondary text
- Muted text
- Primary accent
- Success
- Warning
- Danger
- Info

Create reusable components for:

- Button
- Icon Button
- Input
- Select
- Search Input
- Date Picker
- Card
- Stat Card
- Badge
- Avatar
- Dropdown
- Modal
- Drawer
- Tabs
- Table
- Empty State
- Loading State
- Toast
- Confirmation Dialog
- Form Section
- Page Header
- Breadcrumb
- Pagination
- Mobile Bottom Navigation

Do NOT duplicate styling manually across pages.

==================================================
APPLICATION SHELL
==================================================

Create a premium application shell.

Desktop:

LEFT SIDEBAR

Top:
Gym logo
Gym name

Navigation:

Dashboard
Inquiries
Clients
Packages
Billing & Payments
Attendance
Follow-ups
Reports

Then a separated section:

Management
Settings

Bottom:
User profile
Theme switcher
Logout

The sidebar should support:
- Expanded state
- Collapsed state

Main content area:
- Top header
- Page title
- Search where appropriate
- Notification area
- User menu
- Content area

==================================================
MOBILE EXPERIENCE
==================================================

This is extremely important.

The application must NOT feel like a desktop website squeezed onto a phone.

Create a real mobile UX.

On mobile:

- Sidebar becomes a mobile navigation drawer or bottom navigation where appropriate.
- Large desktop tables should transform into cards or horizontally scrollable data structures.
- Forms should become single-column.
- Buttons must be thumb-friendly.
- Cards must resize intelligently.
- Modals should behave like mobile sheets where appropriate.
- Dashboard statistics must become swipeable or stacked.
- Navigation should remain extremely easy to use with one hand.

Target:
Excellent experience on:
- 360px
- 390px
- 414px
- 768px
- 1024px
- 1280px+
- Large desktop monitors

==================================================
PIXEL PERFECT RESPONSIVENESS
==================================================

Do not use arbitrary fixed widths that break layouts.

Use:
- Responsive grid
- Flexible containers
- Proper spacing scale
- Fluid typography where appropriate
- Consistent alignment
- Proper breakpoint behavior

Every screen should remain visually balanced.

==================================================
DASHBOARD FOUNDATION
==================================================

Create the initial Dashboard page only as a UI foundation.

Use realistic demo data for now.

Create premium statistic cards for:

New Clients
Total Collection
Active Members
Expired Members
Today's Attendance
Follow-ups
Upcoming Renewals
Birthdays Today

Also create:

Quick Actions section

Buttons:
Create Inquiry
Create Client
Create Follow-up
Create POS Bill

And a Recent Activity section.

The dashboard should look impressive immediately.

Do not implement the actual business logic for these modules yet.
Use mocked data for this stage.

==================================================
FIREBASE
==================================================

Connect Firebase using environment variables.

Required Firebase configuration:

projectId:
leadsmanage-1f7cd

authDomain:
leadsmanage-1f7cd.firebaseapp.com

storageBucket:
leadsmanage-1f7cd.firebasestorage.app

messagingSenderId:
1019581568447

appId:
1:1019581568447:web:ee97dfa623591f017d3d0a

measurementId:
@secret:GOOGLE_ANALYTICS_MEASUREMENT_ID 

Set up:

Firebase initialization
Firebase Authentication
Firestore initialization

Prepare a clean Firebase service layer.

Do not scatter Firebase calls throughout UI components.

==================================================
AUTHENTICATION FOUNDATION
==================================================

Create a professional login screen.

Login screen should support:
- Email
- Password
- Show/hide password
- Remember session
- Login button
- Loading state
- Validation
- Error state

Create protected application routes.

Unauthenticated users should be redirected to login.

Authenticated users should access the application shell.

Do not build registration for public users.

This is an admin/staff-oriented application.

==================================================
CLOUDINARY
==================================================

Prepare Cloudinary integration for future:
- Member profile photos
- Gym logo
- Other images

Cloudinary configuration:

Cloud name:
dcoimqij

Upload preset:
levelupingup

Create a reusable image upload utility/component.

Requirements:
- Image preview
- Upload progress
- Success state
- Error state
- Remove image
- Replace image

Do not build member photo functionality yet.
Only create the reusable infrastructure.

==================================================
CODE QUALITY
==================================================

Use clean architecture.

Separate:
- UI components
- Pages
- Firebase services
- Cloudinary utilities
- Types
- Hooks
- Utilities
- Constants

Avoid:
- Giant components
- Repeated code
- Inline business logic everywhere
- Hardcoded colors throughout components
- Hardcoded Firebase initialization inside pages

Use reusable components and centralized design tokens.

==================================================
UX QUALITY
==================================================

Add polished micro-interactions:

- Button hover
- Button press
- Card hover where appropriate
- Smooth page transitions
- Loading skeletons
- Toast feedback
- Modal animations
- Drawer animations
- Dropdown animations

Do not over-animate.

Animations should feel premium and fast.

==================================================
ACCESSIBILITY
==================================================

Use:
- Proper labels
- Keyboard navigation
- Focus states
- Semantic HTML
- Accessible buttons
- Accessible dialogs
- Sufficient color contrast

==================================================
IMPORTANT PRODUCT RULE
==================================================

The application must feel like a REAL commercial SaaS product, not a generated template.

Before finishing:
- Check spacing consistency
- Check typography hierarchy
- Check mobile layout
- Check dark mode
- Check light mode
- Check button sizes
- Check alignment
- Check empty states
- Check loading states
- Check error states
- Check navigation behavior

Do not add unnecessary features.

For this stage, deliver the polished application foundation and UI shell only.

==================================================
FINAL RESULT
==================================================

When complete, I should be able to:

1. Open the application
2. See a premium gym-themed login page
3. Login
4. Enter a polished dashboard
5. Switch between light and dark modes
6. Navigate through the main sections
7. Use the responsive layout on desktop and mobile
8. See the reusable UI system
9. Have Firebase properly initialized
10. Have Cloudinary infrastructure ready

Do not implement WhatsApp yet.
Do not implement biometric hardware communication yet.
Do not implement billing logic yet.
Do not implement follow-up logic yet.

Build the foundation cleanly so those modules can be added in later prompts without refactoring the entire project.






## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
