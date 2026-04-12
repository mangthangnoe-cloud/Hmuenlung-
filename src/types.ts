export type UserRole = 'admin' | 'user';

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  profilePic: string;
  role: UserRole;
  theme: 'light' | 'dark';
  notificationsEnabled: boolean;
  createdAt: number;
}

export interface Post {
  id: string;
  authorId: string;
  authorName: string;
  authorPic: string;
  text: string;
  imageUrl?: string;
  tags: string[];
  likesCount: number;
  commentsCount: number;
  createdAt: number;
  status?: 'active' | 'deleted';
}

export interface Comment {
  id: string;
  postId: string;
  userId: string;
  userName: string;
  userPic: string;
  text: string;
  createdAt: number;
}

export interface Activity {
  id: string;
  userId: string;
  type: 'like' | 'comment' | 'post' | 'save' | 'delete_post';
  targetId: string; // postId
  targetText: string; // snippet of post text
  createdAt: number;
}
