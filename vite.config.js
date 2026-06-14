import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'pages/admin.html'),
        exam: resolve(__dirname, 'pages/exam.html'),
        result: resolve(__dirname, 'pages/result.html'),
        student: resolve(__dirname, 'pages/student.html')
      }
    }
  }
});
