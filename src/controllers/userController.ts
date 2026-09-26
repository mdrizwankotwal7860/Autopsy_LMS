import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { NotFoundError } from '../utils/errors';
// import { sendEligibilityEmail } from '../integrations/email/brevoService';

export const getUsers = async (req: Request, res: Response) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      eligibilityStatus: true,
      createdAt: true
    },
    orderBy: { createdAt: 'desc' }
  });

  res.status(200).json({ users });
};

export const getUserById = async (req: Request, res: Response) => {
  const { id } = req.params;

  const user = await prisma.user.findUnique({
    where: { id: id as string },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      qualification: true,
      professionalRole: true,
      organization: true,
      role: true,
      eligibilityStatus: true,
      cvFileUrl: true,
      createdAt: true,
      enrollments: {
        include: { course: true }
      }
    }
  });

  if (!user) {
    throw new NotFoundError('User not found');
  }

  res.status(200).json({ user });
};

export const updateEligibility = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body; // PENDING, APPROVED, REJECTED

  const user = await prisma.user.findUnique({ where: { id: id as string } });
  if (!user) {
    throw new NotFoundError('User not found');
  }

  const updatedUser = await prisma.user.update({
    where: { id: id as string },
    data: { eligibilityStatus: status as any }
  });

  // Log admin action
  // @ts-ignore
  const adminId = req.user!.id;
  await prisma.auditLog.create({
    data: {
      adminId,
      userId: id as string,
      action: 'UPDATE_ELIGIBILITY',
      resource: 'User',
      resourceId: id as string,
      details: { from: user.eligibilityStatus, to: status }
    }
  });

  // TODO: Send email notification using Brevo
  // if (status === 'APPROVED' || status === 'REJECTED') {
  //   await sendEligibilityEmail(user.email, user.name, status);
  // }

  res.status(200).json({
    message: 'Eligibility status updated successfully',
    user: {
      id: updatedUser.id,
      eligibilityStatus: updatedUser.eligibilityStatus
    }
  });
};
