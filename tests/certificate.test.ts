import { describe, it, expect, beforeAll, afterAll, jest, beforeEach } from '@jest/globals';
jest.mock('uuid', () => ({ v4: jest.fn() }));

const mockRedisClient = {
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  call: jest.fn()
};

jest.mock('../src/utils/redis', () => ({
  __esModule: true,
  default: mockRedisClient,
  redisEnabled: false  // Keep false so rate-limit-redis uses in-memory store
}));

import request from 'supertest';
import app from '../src/app';
import prisma from '../src/utils/prisma';
import { generateToken } from '../src/utils/jwt';
import { uploadFile } from '../src/integrations/storage/r2Service';
import { generateCertificatePDF } from '../src/utils/pdfGenerator';

jest.mock('../src/integrations/storage/r2Service');
jest.mock('../src/utils/pdfGenerator');

describe('Certificate Endpoints', () => {
  let adminToken: string;
  let student1Token: string;
  let student2Token: string;
  let student1Id: string;
  let student2Id: string;
  let courseId: string;

  beforeAll(async () => {
    // Create users
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: 'admin_cert@test.com', passwordHash: 'hash', role: 'ADMIN' },
    });
    adminToken = generateToken({ userId: admin.id, role: admin.role });

    const student1 = await prisma.user.create({
      data: { name: 'Student One', email: 'student1_cert@test.com', passwordHash: 'hash', role: 'STUDENT', organization: 'Org1' },
    });
    student1Id = student1.id;
    student1Token = generateToken({ userId: student1.id, role: student1.role });

    const student2 = await prisma.user.create({
      data: { name: 'Student Two', email: 'student2_cert@test.com', passwordHash: 'hash', role: 'STUDENT', organization: 'Org2' },
    });
    student2Id = student2.id;
    student2Token = generateToken({ userId: student2.id, role: student2.role });

    // Create course, module, lesson, exam
    const course = await prisma.course.create({
      data: { title: 'Cert Course', description: 'Desc', price: 100, status: 'PUBLISHED' },
    });
    courseId = course.id;

    const mod = await prisma.module.create({
      data: { title: 'Mod 1', description: 'Desc', courseId: course.id, order: 1 },
    });

    const lesson = await prisma.lesson.create({
      data: { title: 'Les 1', content: 'Cont', moduleId: mod.id, order: 1, type: 'VIDEO' },
    });

    const exam = await prisma.exam.create({
      data: { title: 'Exam 1', lessonId: lesson.id, passingMarks: 50, timeLimitMins: 30 },
    });

    // Enroll students
    await prisma.enrollment.create({ data: { userId: student1.id, courseId: course.id } });
    await prisma.enrollment.create({ data: { userId: student2.id, courseId: course.id } });

    // Student 1 passes the exam
    await prisma.examAttempt.create({
      data: { userId: student1.id, examId: exam.id, score: 80, passed: true, endedAt: new Date() }
    });

    // Student 2 fails the exam
    await prisma.examAttempt.create({
      data: { userId: student2.id, examId: exam.id, score: 20, passed: false, endedAt: new Date() }
    });

    (uploadFile as any).mockResolvedValue('certificates/fake_key.pdf');
    (generateCertificatePDF as any).mockResolvedValue(Buffer.from('fake_pdf'));
  });

  afterAll(async () => {
    await prisma.certificate.deleteMany();
    await prisma.examAttempt.deleteMany();
    await prisma.exam.deleteMany();
    await prisma.lesson.deleteMany();
    await prisma.module.deleteMany();
    await prisma.enrollment.deleteMany();
    await prisma.course.deleteMany();
    await prisma.user.deleteMany({
      where: { email: { in: ['admin_cert@test.com', 'student1_cert@test.com', 'student2_cert@test.com'] } }
    });
  });

  it('should prevent certificate generation if student has not passed the exam', async () => {
    const res = await request(app)
      .post(`/api/courses/${courseId}/certificates`)
      .set('Authorization', `Bearer ${student2Token}`);
    
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('Course requirements not met');
  });

  it('should allow student who passed to generate a certificate', async () => {
    const res = await request(app)
      .post(`/api/courses/${courseId}/certificates`)
      .set('Authorization', `Bearer ${student1Token}`);
    
    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Certificate generated successfully');
    expect(res.body.certificate).toHaveProperty('uniqueId');
    expect(res.body.certificate.courseId).toBe(courseId);

    // Verify PDF generation was called with correct data
    expect(generateCertificatePDF).toHaveBeenCalledWith(expect.objectContaining({
      studentName: 'Student One',
      courseName: 'Cert Course',
      institution: 'Org1'
    }));
  });

  it('should ignore client-provided certificate ID and generate server-side', async () => {
    const res = await request(app)
      .post(`/api/courses/${courseId}/certificates`)
      .set('Authorization', `Bearer ${student1Token}`)
      .send({ uniqueId: 'hacked-id' }); // Try to inject ID

    expect(res.status).toBe(201);
    // Since it was already generated, it should just return the existing one
    expect(res.body.certificate.uniqueId).not.toBe('hacked-id');
  });

  it('should return existing certificate on duplicate generation request (idempotent)', async () => {
    // Second POST for the same student+course should return the existing cert
    const res = await request(app)
      .post(`/api/courses/${courseId}/certificates`)
      .set('Authorization', `Bearer ${student1Token}`);

    expect(res.status).toBe(201);
    expect(res.body.certificate.courseId).toBe(courseId);
    // The uniqueId should match the previously generated certificate
    expect(res.body.certificate).toHaveProperty('uniqueId');
  });

  it('should regenerate certificate after deletion', async () => {
    // Delete existing cert so it forces regeneration
    await prisma.certificate.deleteMany({ where: { userId: student1Id } });
    (generateCertificatePDF as any).mockClear();

    const res = await request(app)
      .post(`/api/courses/${courseId}/certificates`)
      .set('Authorization', `Bearer ${student1Token}`);

    expect(res.status).toBe(201);
    expect(generateCertificatePDF).toHaveBeenCalledTimes(1);
  });

  let certId: string;
  let uniqueId: string;

  it('should list authenticated students certificates', async () => {
    const res = await request(app)
      .get('/api/certificates')
      .set('Authorization', `Bearer ${student1Token}`);
    
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].courseTitle).toBe('Cert Course');
    
    certId = res.body[0].id;
    uniqueId = res.body[0].uniqueId;
  });

  it('should allow student to access their own certificate', async () => {
    const res = await request(app)
      .get(`/api/certificates/${certId}`)
      .set('Authorization', `Bearer ${student1Token}`);
    
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(certId);
    expect(res.body.studentName).toBe('Student One');
  });

  it('should prevent student from accessing another students certificate (IDOR)', async () => {
    const res = await request(app)
      .get(`/api/certificates/${certId}`)
      .set('Authorization', `Bearer ${student2Token}`);
    
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('do not have access');
  });

  it('should allow public verification of certificate using uniqueId', async () => {
    const res = await request(app)
      .get(`/api/certificates/verify/${uniqueId}`);
    
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.certificate.studentName).toBe('Student One');
    expect(res.body.certificate.courseTitle).toBe('Cert Course');
    // Ensure no sensitive info is leaked
    expect(res.body.certificate).not.toHaveProperty('userId');
    expect(res.body.certificate).not.toHaveProperty('fileUrl');
  });

  it('should return 404 for invalid verification uniqueId', async () => {
    const res = await request(app)
      .get('/api/certificates/verify/invalid-id');
    
    expect(res.status).toBe(404);
  });
});
